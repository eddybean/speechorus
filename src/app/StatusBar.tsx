// The bottom bar: the generation queue on the left, the loaded model on the right.
import { chosenProfile, queueEta, useApp } from "../store/app";
import type { DownloadProgress } from "../lib/types";
import { fmtEta } from "../lib/text";
import { Icon } from "./icons";

const ACTIVE = ["checking", "downloading", "verifying"];

/** `irodori-tts-large:q8_0 42%・残り3分` for the first running download, and how many more run (D-59). */
export function downloadSummary(downloads: Record<string, DownloadProgress>): string | null {
  const running = Object.values(downloads).filter((d) => ACTIVE.includes(d.phase));
  const d = running[0];
  if (!d) return null;
  const pct = d.total ? `${Math.floor(Math.min(100, (d.done / d.total) * 100))}%` : "";
  const what =
    d.phase === "downloading" ? [pct, `残り ${fmtEta(d.etaSecs)}`] : [d.phase === "verifying" ? "検証中" : "確認中"];
  const more = running.length > 1 ? `（ほか ${running.length - 1} 件）` : "";
  return `${d.id} ${what.filter(Boolean).join("・")}${more}`;
}

export function formatEta(sec: number): string {
  return sec < 60 ? `約${Math.ceil(sec)}秒` : `約${Math.floor(sec / 60)}分${Math.ceil(sec % 60)}秒`;
}

export function StatusBar() {
  const jobCount = useApp((s) => s.jobOrder.length);
  const running = useApp((s) => Object.values(s.jobs).find((j) => j.status === "running"));
  const eta = useApp((s) => queueEta(s.jobOrder.length, s.jobDurations, s.runningSince));
  const engine = useApp((s) => s.engine);
  const profiles = useApp((s) => s.settings?.profiles);
  const profileName =
    "profileId" in engine ? (profiles?.find((p) => p.id === engine.profileId)?.name ?? engine.profileId) : null;
  // Nothing is loaded and the chosen profile has no model: starting would fail, so point to the catalog instead.
  const missing = useApp((s) =>
    s.engine.state === "stopped" || s.engine.state === "failed" ? chosenProfile(s.settings) : undefined,
  );
  const needsModel = missing && !missing.model ? missing : null;
  const starting = useApp((s) => s.engineStarting);
  const startingName = profiles?.find((p) => p.id === starting)?.name ?? starting;
  const download = useApp((s) => downloadSummary(s.downloads));
  return (
    <footer className="statusbar">
      {download && (
        <button
          className="small download-summary"
          title="ダウンロードの詳細を開く"
          onClick={() => useApp.getState().openDialog("catalog")}
        >
          <Icon name="download" size={12} />
          {download}
        </button>
      )}
      {jobCount > 0 && (
        <>
          <span className="queue">
            生成キュー 残り {jobCount} 件{running ? `・${running.seconds.toFixed(1)}s` : ""}
            {eta !== null ? `・${formatEta(eta)}` : ""}
          </span>
          <button className="small" onClick={() => void useApp.getState().cancelAll()}>
            <Icon name="stop" size={12} />
            中止
          </button>
        </>
      )}
      <span className="engine-summary">
        <span className={`dot ${engine.state}`} />
        {starting && engine.state !== "loading" ? (
          `${startingName} の起動を準備中…`
        ) : needsModel ? (
          <>
            {needsModel.name} のモデルが未設定です
            <button className="small primary" onClick={() => useApp.getState().openDialog("catalog")}>
              <Icon name="download" size={12} />
              モデルを入手…
            </button>
          </>
        ) : engine.state === "ready" ? (
          `${profileName} · ${engine.sampleRate / 1000} kHz`
        ) : engine.state === "loading" ? (
          `${profileName} を読み込み中…`
        ) : engine.state === "failed" ? (
          `${profileName} の起動に失敗`
        ) : (
          "エンジン停止中（左下の「エンジン」から起動）"
        )}
      </span>
    </footer>
  );
}
