// New / open / save / import.
import { open, save } from "@tauri-apps/plugin-dialog";
import { ipc } from "../../lib/ipc";
import { parseScript } from "../../lib/text";
import type { Project } from "../../lib/types";
import { useApp } from "../../store/app";
import { emptyProject, newCast, newLine, useProject } from "../../store/project";

function confirmDiscard(): boolean {
  return !useProject.getState().dirty || confirm("保存していない変更があります。破棄しますか？");
}

export async function newProject() {
  if (!confirmDiscard()) return;
  const dir = await ipc.projectNew();
  useProject.getState().load(emptyProject(), null, dir);
}

export async function openProject(path?: string) {
  if (!confirmDiscard()) return;
  const p = path ?? (await open({ multiple: false, filters: [{ name: "Voice Studio", extensions: ["vsproj"] }] }));
  if (!p) return;
  try {
    const r = await ipc.projectLoad(String(p));
    useProject.getState().load(r.project, r.path, r.takesDir);
    const s = await ipc.getSettings();
    useApp.setState({ settings: s });
  } catch (e) {
    useApp.getState().notify("error", `開けません: ${e}`);
  }
}

export async function saveProject(as = false): Promise<boolean> {
  const st = useProject.getState();
  let path = st.path;
  if (as || !path) {
    const p = await save({ defaultPath: `${st.project.name}.vsproj`, filters: [{ name: "Voice Studio", extensions: ["vsproj"] }] });
    if (!p) return false;
    path = String(p);
  }
  const name = path.split(/[\\/]/).pop()!.replace(/\.vsproj$/i, "");
  const project: Project = { ...st.project, name, modelProfileId: useApp.getState().activeProfile()?.id ?? st.project.modelProfileId };
  try {
    const takesDir = await ipc.projectSave(path, project, st.takesDir || null);
    // Takes deleted (and not undone) since the last save are removed from disk now.
    await ipc.projectPrune(project, takesDir);
    useProject.setState((s) => ({ project: { ...s.project, name, modelProfileId: project.modelProfileId } }));
    useProject.getState().markSaved(path, takesDir);
    useApp.getState().notify("info", `保存しました: ${path}`);
    return true;
  } catch (e) {
    useApp.getState().notify("error", `保存できません: ${e}`);
    return false;
  }
}

/** Imports a VOICEVOX-style `キャラ,テキスト` txt/csv after the active line, creating casts for new names. */
export async function importScript() {
  const p = await open({ multiple: false, filters: [{ name: "台本", extensions: ["txt", "csv", "tsv"] }] });
  if (!p) return;
  const text = await ipc.readTextFile(String(p));
  const rows = parseScript(text);
  if (!rows.length) {
    useApp.getState().notify("info", "取り込める行がありません");
    return;
  }
  const st = useProject.getState();
  st.edit("台本を取り込み", (d) => {
    const byName = new Map(d.cast.map((c) => [c.name, c.id]));
    const fallback = d.lines.find((l) => l.id === st.activeLineId)?.castId ?? d.cast[0]?.id ?? null;
    const lines = rows.map((r) => {
      let castId = fallback;
      if (r.castName) {
        if (!byName.has(r.castName)) {
          const c = newCast(r.castName, d.cast.length);
          d.cast.push(c);
          byName.set(r.castName, c.id);
        }
        castId = byName.get(r.castName)!;
      }
      return newLine({ castId, text: r.text });
    });
    // Replace a single empty line (a new project) instead of keeping it.
    if (d.lines.length === 1 && !d.lines[0].text.trim() && d.lines[0].takes.length === 0) d.lines = lines;
    else {
      const i = d.lines.findIndex((l) => l.id === st.activeLineId);
      d.lines.splice(i < 0 ? d.lines.length : i + 1, 0, ...lines);
    }
  });
  useApp.getState().notify("info", `${rows.length} 行を取り込みました`);
}
