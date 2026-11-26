// Export: each line as a WAV (file name template, serials) or one joined WAV with silences, SRT and txt.
import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { ipc, joinPath } from "../../lib/ipc";
import type { ExportItem, Project } from "../../lib/types";
import { useApp } from "../../store/app";
import { selectedTake, useProject } from "../../store/project";
import { Dialog } from "../../app/Dialog";

export function exportItems(
  project: Project,
  takesDir: string,
  lineIds: string[] | null,
): { items: ExportItem[]; missing: number; seconds: number } {
  let missing = 0;
  let seconds = 0;
  const items: ExportItem[] = [];
  for (const l of project.lines) {
    if (lineIds && !lineIds.includes(l.id)) continue;
    if (!l.text.trim()) continue;
    const t = selectedTake(l);
    if (!t) {
      missing++;
      continue;
    }
    seconds += l.preSilence + t.duration + l.postSilence;
    items.push({
      path: joinPath(takesDir, t.file),
      text: l.text,
      cast: project.cast.find((c) => c.id === l.castId)?.name ?? "",
      preSilence: l.preSilence,
      postSilence: l.postSilence,
      seed: t.seed,
    });
  }
  return { items, missing, seconds };
}

export function ExportDialog() {
  const project = useProject((s) => s.project);
  const takesDir = useProject((s) => s.takesDir);
  const selection = useProject((s) => s.selection);
  const [kind, setKind] = useState<"joined" | "each">("joined");
  const [scope, setScope] = useState<"all" | "selection">(selection.length > 1 ? "selection" : "all");
  const [tpl, setTpl] = useState(project.exportSettings.fileTemplate);
  const [srt, setSrt] = useState(true);
  const [txt, setTxt] = useState(true);
  const [srtCast, setSrtCast] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string[] | null>(null);
  const app = useApp.getState;
  const { items, missing, seconds: total } = exportItems(project, takesDir, scope === "selection" ? selection : null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      if (tpl !== project.exportSettings.fileTemplate)
        useProject.getState().edit("書き出し設定", (d) => void (d.exportSettings.fileTemplate = tpl));
      if (kind === "joined") {
        const path = await save({
          defaultPath: `${project.name}.wav`,
          filters: [{ name: "WAV", extensions: ["wav"] }],
        });
        if (!path) return;
        const r = await ipc.exportJoined({ items, wavPath: path, srt, txt, srtWithCast: srtCast });
        setResult(r.files);
      } else {
        const dir = await open({
          directory: true,
          title: "書き出し先フォルダ",
          defaultPath: project.exportSettings.outDir || undefined,
        });
        if (!dir) return;
        useProject.getState().edit("書き出し先", (d) => void (d.exportSettings.outDir = String(dir)));
        const r = await ipc.exportEach(items, String(dir), tpl, txt);
        setResult(r.files);
      }
    } catch (e) {
      app().notify("error", `書き出しに失敗: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="書き出し" onClose={() => app().openDialog(null)}>
      <div className="radio-row">
        <label>
          <input type="radio" checked={kind === "joined"} onChange={() => setKind("joined")} />{" "}
          結合WAV（前後の無音つき）
        </label>
        <label>
          <input type="radio" checked={kind === "each"} onChange={() => setKind("each")} /> 行ごとのWAV
        </label>
      </div>
      <div className="radio-row">
        <label>
          <input type="radio" checked={scope === "all"} onChange={() => setScope("all")} /> 全行
        </label>
        <label>
          <input
            type="radio"
            checked={scope === "selection"}
            disabled={selection.length === 0}
            onChange={() => setScope("selection")}
          />{" "}
          選択中の行 ({selection.length})
        </label>
      </div>
      {kind === "each" ? (
        <>
          <label className="block">
            ファイル名テンプレート
            <input value={tpl} onChange={(e) => setTpl(e.target.value)} />
            <span className="muted small-text">{"{index} {cast} {text8} {text} {seed}"} — 同名は _2, _3 … の連番</span>
          </label>
          <label>
            <input type="checkbox" checked={txt} onChange={(e) => setTxt(e.target.checked)} /> 各WAVと同名の .txt
            も書き出す
          </label>
        </>
      ) : (
        <>
          <label>
            <input type="checkbox" checked={srt} onChange={(e) => setSrt(e.target.checked)} /> SRT 字幕
          </label>
          <label>
            <input type="checkbox" checked={srtCast} disabled={!srt} onChange={(e) => setSrtCast(e.target.checked)} />{" "}
            字幕に話者名を入れる
          </label>
          <label>
            <input type="checkbox" checked={txt} onChange={(e) => setTxt(e.target.checked)} /> 台本
            .txt（キャラ,テキスト）
          </label>
        </>
      )}
      <p className="muted">
        {items.length} 行{kind === "joined" ? `・約 ${total.toFixed(1)} 秒` : ""}
        {missing > 0 && <span className="warn-text">（テイクのない {missing} 行は含まれません）</span>}
      </p>
      <div className="row-buttons">
        <button className="primary" disabled={busy || items.length === 0} onClick={run}>
          {busy ? "書き出し中…" : "書き出す…"}
        </button>
      </div>
      {result && (
        <div className="ok-text">
          ✓ {result.length} ファイルを書き出しました
          <ul className="files">
            {result.slice(0, 8).map((f) => (
              <li key={f}>{f}</li>
            ))}
            {result.length > 8 && <li>…</li>}
          </ul>
        </div>
      )}
    </Dialog>
  );
}
