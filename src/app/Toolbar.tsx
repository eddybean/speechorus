import { queueEta, useApp } from "../store/app";
import { useProject } from "../store/project";
import { usePlayer } from "../lib/player";
import { generateAll, generateMissing, generateSelected, createScene, fromItems, session } from "../features/generate/actions";
import { PlayButton } from "./PlayButton";
import { importScript, newProject, openProject, saveProject } from "../features/project/fileOps";
import type { SeedMode } from "../lib/text";
import { copyLines, pasteLines } from "../features/script/clipboard";

export function Toolbar() {
  const settings = useApp((s) => s.settings);
  const engine = useApp((s) => s.engine);
  const batch = useApp((s) => s.batch);
  const jobCount = useApp((s) => s.jobOrder.length);
  const running = useApp((s) => Object.values(s.jobs).find((j) => j.status === "running"));
  const eta = useApp((s) => queueEta(s.jobOrder.length, s.jobDurations, s.runningSince));
  const canUndo = useProject((s) => s.undoStack.length > 0);
  const canRedo = useProject((s) => s.redoStack.length > 0);
  const dirty = useProject((s) => s.dirty);
  const name = useProject((s) => s.project.name);
  const selection = useProject((s) => s.selection);
  const activeLineId = useProject((s) => s.activeLineId);
  // Stop (back to the start) is offered whenever anything plays or is paused.
  const active = usePlayer((s) => s.sessionKey !== null);
  const app = useApp.getState;
  // The profile chosen in the selector; the engine may still run another one until "切替".
  const prof = useApp((s) => s.settings?.profiles.find((p) => p.id === s.settings?.activeProfileId) ?? s.settings?.profiles[0]);

  const engineLabel =
    engine.state === "ready" ? "● 準備完了" : engine.state === "loading" ? "◌ 読み込み中…" : engine.state === "failed" ? "× 失敗" : "○ 停止中";
  return (
    <header className="toolbar">
      <div className="group">
        <button onClick={newProject} title="新規">
          🗋
        </button>
        <button onClick={() => openProject()} title="開く (Ctrl+O)">
          📂
        </button>
        <button onClick={() => saveProject()} title="保存 (Ctrl+S)">
          💾
        </button>
        <button onClick={() => saveProject(true)} title="名前を付けて保存">
          💾…
        </button>
        <button onClick={importScript} title="txt/csv を取り込み">
          📥
        </button>
        <span className="title">
          {name}
          {dirty ? " *" : ""}
        </span>
      </div>
      <div className="group">
        <button disabled={!canUndo} onClick={() => useProject.getState().undo()} title="元に戻す (Ctrl+Z)">
          ↶
        </button>
        <button disabled={!canRedo} onClick={() => useProject.getState().redo()} title="やり直し (Ctrl+Y)">
          ↷
        </button>
        <button disabled={!selection.length && !activeLineId} onClick={() => copyLines()} title="行をコピー（複数行選択時は Ctrl+C）">
          ⧉
        </button>
        <button onClick={() => pasteLines()} title="行を貼り付け（複数行選択時は Ctrl+V）">
          📋
        </button>
      </div>
      <div className="group engine">
        <select
          value={prof?.id ?? ""}
          onChange={(e) => settings && app().saveSettings({ ...settings, activeProfileId: e.target.value })}
          disabled={engine.state === "loading"}
          title="モデルプロファイル"
        >
          {settings?.profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span className={`engine-state ${engine.state}`}>{engineLabel}</span>
        {engine.state === "ready" || engine.state === "loading" ? (
          <button onClick={() => app().stopEngine()}>停止</button>
        ) : null}
        {prof && !(engine.state === "ready" && engine.profileId === prof.id) && engine.state !== "loading" && (
          <button className="primary" onClick={() => app().startEngine(prof.id)}>
            {engine.state === "ready" ? "切替" : "起動"}
          </button>
        )}
        <button onClick={() => app().openDialog("catalog")} title="モデルカタログからダウンロード" className={prof && !prof.model ? "primary" : ""}>
          ⤓ モデルを入手
        </button>
        <button onClick={() => app().openDialog("models")} title="モデル管理">
          モデル管理
        </button>
      </div>
      <div className="group gen">
        <label title="1行あたりのテイク数">
          テイク
          <input type="number" min={1} max={20} value={batch.takesPerLine} onChange={(e) => app().setBatch({ takesPerLine: Math.max(1, Number(e.target.value)) })} />
        </label>
        <select value={batch.seedMode} onChange={(e) => app().setBatch({ seedMode: e.target.value as SeedMode })} title="シード">
          <option value="random">シード: ランダム</option>
          <option value="fixed">シード: 固定</option>
          <option value="sequential">シード: 連番</option>
        </select>
        {batch.seedMode !== "random" && <input className="seed" type="number" min={0} value={batch.baseSeed} onChange={(e) => app().setBatch({ baseSeed: Number(e.target.value) })} />}
        <button onClick={() => generateSelected()} title="選択行を生成 (Ctrl+Enter)">
          ⚡ 選択
        </button>
        <button onClick={generateMissing} title="テイクのない行だけ生成">
          ⚡ 未生成
        </button>
        <button onClick={generateAll} title="全行を生成">
          ⚡ 全行
        </button>
        <button disabled={selection.length < 2} onClick={() => createScene(selection)} title="選択行からシーンを作成">
          🎬 シーン
        </button>
        {jobCount > 0 && (
          <>
            <span className="queue">
              残り {jobCount}
              {running ? `・${running.seconds.toFixed(1)}s` : ""}
              {eta !== null ? `・残り約${eta < 60 ? `${Math.ceil(eta)}秒` : `${Math.floor(eta / 60)}分${Math.ceil(eta % 60)}秒`}` : ""}
            </span>
            <button onClick={() => app().cancelAll()}>■ 中止</button>
          </>
        )}
      </div>
      <div className="group">
        <PlayButton session={session.sequence} items={() => fromItems(activeLineId)} title="選択行から連続再生" label="連続再生" />
        {active && (
          <button onClick={() => usePlayer.getState().stop()} title="停止（位置を破棄して頭に戻す）">
            ■ 停止
          </button>
        )}
        <button onClick={() => app().openDialog("export")}>⤓ 書き出し</button>
        <button className="icon" onClick={() => app().openDialog("settings")} title="設定" aria-label="設定">
          <GearIcon />
        </button>
      </div>
    </header>
  );
}

/** The usual settings cog. */
export function GearIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
