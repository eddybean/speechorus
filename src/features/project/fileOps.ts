// New / open / save / import.
import { open, save } from "@tauri-apps/plugin-dialog";
import { ipc } from "../../lib/ipc";
import { parseScript } from "../../lib/text";
import type { Project } from "../../lib/types";
import { useApp } from "../../store/app";
import { emptyProject, historyTakeFiles, newCast, newLine, useProject } from "../../store/project";

function confirmDiscard(): boolean {
  return !useProject.getState().dirty || confirm("保存していない変更があります。破棄しますか？");
}

/** The untitled project being left behind has no other use for its work folder's takes (D-39). */
function releaseUntitled(takesDir: string, path: string | null) {
  if (!path && takesDir) ipc.projectRelease(takesDir).catch(() => {});
}

export async function newProject() {
  if (!confirmDiscard()) return;
  const prev = useProject.getState();
  const dir = await ipc.projectNew();
  useProject.getState().load(emptyProject(), null, dir);
  releaseUntitled(prev.takesDir, prev.path);
}

export async function openProject(path?: string) {
  if (!confirmDiscard()) return;
  const p = path ?? (await open({ multiple: false, filters: [{ name: "Speechorus", extensions: ["vsproj"] }] }));
  if (!p) return;
  try {
    await loadProject(String(p));
  } catch (e) {
    useApp.getState().notify("error", `開けません: ${e}`);
  }
}

async function loadProject(path: string) {
  const prev = useProject.getState();
  const r = await ipc.projectLoad(path);
  useProject.getState().load(r.project, r.path, r.takesDir);
  releaseUntitled(prev.takesDir, prev.path);
  // Takes made but never saved last time (closed without saving, a crash) are removed now (D-39).
  ipc.projectPrune(r.project, r.takesDir).catch(() => {});
  await syncRecentProjects().catch(() => {});
}

/**
 * Takes the recent-files list the core updated on open/save. Only that field: the rest of the UI's settings may hold
 * changes not written yet (the debounced volume), and the UI writes the whole settings back later.
 */
async function syncRecentProjects() {
  const { recentProjects } = await ipc.getSettings();
  useApp.setState((s) => ({ settings: s.settings && { ...s.settings, recentProjects } }));
}

/** Opens a project from the 最近使ったファイル menu; one that cannot be opened (moved, deleted) leaves the list. */
export async function openRecentProject(path: string) {
  if (!confirmDiscard()) return;
  try {
    await loadProject(path);
  } catch (e) {
    await forgetRecentProjects([path]);
    useApp.getState().notify("error", `開けません（最近使ったファイルから外しました）: ${e}`);
  }
}

/** Removes the given paths from the recent-files list, or every path when none are given. */
export async function forgetRecentProjects(paths?: string[]) {
  const s = useApp.getState().settings;
  if (!s) return;
  const recentProjects = paths ? s.recentProjects.filter((p) => !paths.includes(p)) : [];
  await useApp.getState().saveSettings({ ...s, recentProjects });
}

export async function saveProject(as = false): Promise<boolean> {
  const st = useProject.getState();
  let path = st.path;
  if (as || !path) {
    const p = await save({
      defaultPath: `${st.project.name}.vsproj`,
      filters: [{ name: "Speechorus", extensions: ["vsproj"] }],
    });
    if (!p) return false;
    path = String(p);
  }
  const name = path
    .split(/[\\/]/)
    .pop()!
    .replace(/\.vsproj$/i, "");
  const project: Project = {
    ...st.project,
    name,
    modelProfileId: useApp.getState().activeProfile()?.id ?? st.project.modelProfileId,
  };
  try {
    // Takes the Undo history can bring back stay on disk (and move with Save As); other deleted ones go now.
    const keep = historyTakeFiles(st);
    const takesDir = await ipc.projectSave(path, project, st.takesDir || null, keep);
    await ipc.projectPrune(project, takesDir, keep);
    useProject.setState((s) => ({ project: { ...s.project, name, modelProfileId: project.modelProfileId } }));
    useProject.getState().markSaved(path, takesDir);
    await syncRecentProjects().catch(() => {});
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
