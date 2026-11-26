// The bottom bar: the generation queue on the left, the loaded model on the right.
import { chosenProfile, queueEta, useApp } from "../store/app";
import { Icon } from "./icons";

export function formatEta(sec: number): string {
  return sec < 60 ? `約${Math.ceil(sec)}秒` : `約${Math.floor(sec / 60)}分${Math.ceil(sec % 60)}秒`;
}

export function StatusBar() {
  const jobCount = useApp((s) => s.jobOrder.length);
  const running = useApp((s) => Object.values(s.jobs).find((j) => j.status === "running"));
  const eta = useApp((s) => queueEta(s.jobOrder.length, s.jobDurations, s.runningSince));
  const engine = useApp((s) => s.engine);
  const profiles = useApp((s) => s.settings?.profiles);
  const profileName = "profileId" in engine ? (profiles?.find((p) => p.id === engine.profileId)?.name ?? engine.profileId) : null;
  // Nothing is loaded and the chosen profile has no model: starting would fail, so point to the catalog instead.
  const missing = useApp((s) => (s.engine.state === "stopped" || s.engine.state === "failed" ? chosenProfile(s.settings) : undefined));
  const needsModel = missing && !missing.model ? missing : null;
  return (
    <footer className="statusbar">
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
        {needsModel ? (
          <>
            {needsModel.name} のモデルが未設定です
            <button className="small primary" onClick={() => useApp.getState().openDialog("catalog")}>
              <Icon name="download" size={12} />
              モデルを入手…
            </button>
          </>
        ) : engine.state === "ready"
          ? `${profileName} · ${engine.sampleRate / 1000} kHz`
          : engine.state === "loading"
            ? `${profileName} を読み込み中…`
            : engine.state === "failed"
              ? `${profileName} の起動に失敗`
              : "エンジン停止中（左下の「エンジン」から起動）"}
      </span>
    </footer>
  );
}
