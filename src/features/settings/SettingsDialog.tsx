import { useEffect, useState } from "react";
import { ipc } from "../../lib/ipc";
import { useApp } from "../../store/app";
import { Dialog } from "../../app/Dialog";
import { InstallButton } from "../models/ModelManager";

export function SettingsDialog() {
  const s = useApp((x) => x.settings)!;
  const logs = useApp((x) => x.logs);
  const app = useApp.getState;
  const [mem, setMem] = useState(0);
  useEffect(() => {
    const t = setInterval(() => ipc.processMemory().then(setMem), 1000);
    ipc.processMemory().then(setMem);
    return () => clearInterval(t);
  }, []);
  return (
    <Dialog title="設定" onClose={() => app().openDialog(null)}>
      <label>
        <input
          type="checkbox"
          checked={s.showNsfwTags}
          onChange={(e) => app().saveSettings({ ...s, showNsfwTags: e.target.checked })}
        />{" "}
        NSFW タグをパレットに表示する
      </label>
      <label className="block">
        テーマ
        <select
          value={s.theme}
          onChange={(e) => app().saveSettings({ ...s, theme: e.target.value as "dark" | "light" })}
        >
          <option value="dark">ダーク</option>
          <option value="light">ライト</option>
        </select>
      </label>
      <label className="block">
        speech.exe（ASR・ボイス作成・デバイス一覧に使用）
        <input value={s.speechExe} onChange={(e) => app().saveSettings({ ...s, speechExe: e.target.value })} />
      </label>
      <InstallButton />
      <div className="grid2">
        <label>
          書き起こしモデル (ASR)
          <input value={s.asrModel} onChange={(e) => app().saveSettings({ ...s, asrModel: e.target.value })} />
        </label>
        <label>
          ASR デバイス
          <input value={s.asrDevice} onChange={(e) => app().saveSettings({ ...s, asrDevice: e.target.value })} />
        </label>
      </div>
      <p className="muted small-text">
        GUI プロセスのワーキングセット: {(mem / 2 ** 20).toFixed(0)} MB（WebView2 は別プロセス）
      </p>
      <details>
        <summary>エンジンのログ ({logs.length})</summary>
        <pre className="log">{logs.slice(-80).join("\n")}</pre>
      </details>
    </Dialog>
  );
}
