// Model profiles: speech.exe, GGUF (or catalog name), device, env; check, start, switch.
import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ipc } from "../../lib/ipc";
import type { Json, ModelProfile } from "../../lib/types";
import { useApp } from "../../store/app";
import { Page } from "../../app/Page";
import { uid } from "../../lib/text";

type Devices = Awaited<ReturnType<typeof ipc.listDevices>>["devices"];
type Catalog = Awaited<ReturnType<typeof ipc.modelCatalog>>["models"];

const gib = (b: number) => (b / 2 ** 30).toFixed(1) + " GiB";

export function ModelManager() {
  const settings = useApp((s) => s.settings)!;
  const adapters = useApp((s) => s.adapters);
  const engine = useApp((s) => s.engine);
  // The page stays mounted while hidden, so free VRAM is read again each time it is shown.
  const shown = useApp((s) => s.view === "models");
  const [sel, setSel] = useState(settings.activeProfileId ?? settings.profiles[0]?.id ?? "");
  const [devices, setDevices] = useState<Devices>([]);
  const [catalog, setCatalog] = useState<Catalog>([]);
  const [check, setCheck] = useState<{ path: string; info: Record<string, Json>; sidecar: boolean } | string | null>(
    null,
  );
  const [version, setVersion] = useState("");
  const app = useApp.getState;
  // The chosen profile may be gone (deleted from elsewhere while the page was hidden): fall back to the active one.
  const prof =
    settings.profiles.find((p) => p.id === sel) ??
    settings.profiles.find((p) => p.id === settings.activeProfileId) ??
    settings.profiles[0];
  const adapter = adapters.find((a) => a.id === prof?.adapter);

  useEffect(() => {
    if (!shown) return;
    ipc
      .listDevices()
      .then((d) => setDevices(d.devices))
      .catch(() => setDevices([]));
  }, [settings.speechExe, shown]);
  useEffect(() => {
    ipc
      .modelCatalog()
      .then((c) => setCatalog(c.models.filter((m) => m.task === "synthesis")))
      .catch(() => setCatalog([]));
  }, [settings.speechExe]);
  useEffect(() => {
    setCheck(null);
    if (prof?.speechExe)
      ipc
        .speechVersion(prof.speechExe)
        .then(setVersion)
        .catch((e) => setVersion(`エラー: ${e}`));
  }, [sel, prof?.speechExe]);

  const save = (p: ModelProfile) =>
    app().saveSettings({ ...settings, profiles: settings.profiles.map((x) => (x.id === p.id ? p : x)) });
  const pickFile = async (ext: string[], title: string) => {
    const f = await open({ multiple: false, title, filters: [{ name: ext.join("/"), extensions: ext }] });
    return f ? String(f) : null;
  };

  const addProfile = async (adapterId: string) => {
    const a = adapters.find((x) => x.id === adapterId)!;
    const p = await ipc.newProfile(
      adapterId,
      uid().slice(0, 8),
      `${a.displayName} 新規`,
      adapterId === "irodori" ? "irodori-tts-mf" : "",
      settings.speechExe,
    );
    await app().saveSettings({ ...settings, profiles: [...settings.profiles, p] });
    setSel(p.id);
  };

  const running = engine.state !== "stopped" && "profileId" in engine && engine.profileId === sel;
  const free = devices.find((d) => d.name === prof?.device)?.memory_free;
  const need = check && typeof check !== "string" ? Number(check.info.file_bytes ?? 0) : 0;

  return (
    <Page title="モデル管理">
      <div className="models">
        <div className="profile-list">
          {settings.profiles.map((p) => (
            <button key={p.id} className={p.id === sel ? "on" : ""} onClick={() => setSel(p.id)}>
              {p.name}
              {engine.state !== "stopped" && "profileId" in engine && engine.profileId === p.id && (
                <span className={`dot ${engine.state}`} />
              )}
            </button>
          ))}
          <button className="small primary" onClick={() => app().openDialog("catalog")}>
            ⤓ カタログから入手
          </button>
          <div className="muted small-text">手動で追加:</div>
          {adapters.map((a) => (
            <button key={a.id} className="small" onClick={() => addProfile(a.id)}>
              ＋ {a.displayName}
            </button>
          ))}
        </div>
        {prof && adapter && (
          <div className="profile-form">
            <label className="block">
              名前
              <input value={prof.name} onChange={(e) => save({ ...prof, name: e.target.value })} />
            </label>
            <label className="block">
              アダプタ
              <select value={prof.adapter} onChange={(e) => save({ ...prof, adapter: e.target.value })}>
                {adapters.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              speech.exe
              <span className="with-button">
                <input value={prof.speechExe} onChange={(e) => save({ ...prof, speechExe: e.target.value })} />
                <button
                  onClick={async () => {
                    const f = await pickFile(["exe"], "speech.exe");
                    if (f) await save({ ...prof, speechExe: f });
                  }}
                >
                  …
                </button>
              </span>
              <span className="muted small-text">
                {version || "（未確認）"} — 公式 Windows 版は Vulkan ビルドです。
              </span>
              <InstallButton />
            </label>
            <label className="block">
              モデル（GGUF のパス、または speech.cpp のモデル名）
              <span className="with-button">
                <input
                  value={prof.model}
                  placeholder="E:\models\Drama-35B-A3B-Japanese-v3-Q4_K.gguf"
                  onChange={(e) => save({ ...prof, model: e.target.value })}
                />
                <button
                  onClick={async () => {
                    const f = await pickFile(["gguf"], "モデル");
                    if (f) await save({ ...prof, model: f });
                  }}
                >
                  …
                </button>
              </span>
            </label>
            {prof.adapter === "irodori" && catalog.length > 0 && (
              <div className="catalog">
                {catalog
                  .filter((m) => m.name.startsWith("irodori"))
                  .map((m) => {
                    const f = m.files[0];
                    return (
                      <button
                        key={m.name}
                        className={prof.model === m.name ? "on small" : "small"}
                        onClick={() => save({ ...prof, model: m.name })}
                        title={f?.path}
                      >
                        {m.name} ({(f.size / 1e9).toFixed(2)} GB
                        {f.fetched ? "・取得済" : "・未取得: 起動時にダウンロード"})
                      </button>
                    );
                  })}
              </div>
            )}
            <div className="grid2">
              <label>
                デバイス
                <select value={prof.device} onChange={(e) => save({ ...prof, device: e.target.value })}>
                  <option value="auto">auto</option>
                  {devices.map((d) => (
                    <option key={d.name} value={d.name}>
                      {d.name} — {d.description.trim()} ({gib(d.memory_free)} 空き / {gib(d.memory_total)})
                    </option>
                  ))}
                  {!devices.some((d) => d.name === prof.device) && prof.device !== "auto" && (
                    <option value={prof.device}>{prof.device}</option>
                  )}
                </select>
              </label>
              <label>
                スレッド
                <input
                  type="number"
                  min={0}
                  value={prof.threads ?? ""}
                  placeholder="自動"
                  onChange={(e) => save({ ...prof, threads: e.target.value ? Number(e.target.value) : null })}
                />
              </label>
            </div>
            <label className="block">
              環境変数（1行に KEY=VALUE）
              <textarea
                rows={3}
                defaultValue={Object.entries(prof.env)
                  .map(([k, v]) => `${k}=${v}`)
                  .join("\n")}
                onBlur={(e) => {
                  const env: Record<string, string> = {};
                  for (const l of e.target.value.split("\n")) {
                    const i = l.indexOf("=");
                    if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim();
                  }
                  void save({ ...prof, env });
                }}
              />
              {prof.adapter === "drama3" && (
                <span className="muted small-text">
                  Drama-3 Q4_K/Q5_K は Vulkan で GGML_VK_DISABLE_F16 / COOPMAT / COOPMAT2 = 1 が必要です（CUDA 不可）。
                </span>
              )}
            </label>
            <label className="block">
              追加の引数（スペース区切り）
              <input
                defaultValue={prof.extraArgs.join(" ")}
                onBlur={(e) => save({ ...prof, extraArgs: e.target.value.split(/\s+/).filter(Boolean) })}
              />
            </label>
            <p className="license">⚖ {adapter.capabilities.licenseNote}</p>
            <div className="row-buttons">
              <button
                onClick={async () => {
                  setCheck("確認中…");
                  try {
                    setCheck(await ipc.modelInfo(prof.id));
                  } catch (e) {
                    setCheck(`エラー: ${e}`);
                  }
                }}
              >
                モデルを確認
              </button>
              {running ? (
                <button onClick={() => app().stopEngine()}>停止</button>
              ) : (
                <button className="primary" onClick={() => app().startEngine(prof.id)}>
                  このモデルで起動（切替）
                </button>
              )}
              <button
                className="danger"
                disabled={settings.profiles.length <= 1}
                onClick={() => {
                  if (!confirm(`プロファイル「${prof.name}」を削除しますか？（モデルファイルは消えません）`)) return;
                  const rest = settings.profiles.filter((p) => p.id !== prof.id);
                  void app().saveSettings({ ...settings, profiles: rest, activeProfileId: rest[0]?.id ?? null });
                  setSel(rest[0]?.id ?? "");
                }}
              >
                削除
              </button>
            </div>
            {typeof check === "string" && <p className="muted">{check}</p>}
            {check && typeof check !== "string" && (
              <div className="check">
                <div>
                  <b>{String(check.info.name ?? "")}</b> {String(check.info.weight_type ?? "")} —{" "}
                  {String(check.info.architecture ?? "")}, {String(check.info.sample_rate ?? "")} Hz
                </div>
                <div className="muted small-text">{check.path}</div>
                {prof.model.toLowerCase().endsWith(".gguf") && (
                  <div className={check.sidecar ? "ok-text" : "warn-text"}>
                    {check.sidecar
                      ? "✓ .gguf.json サイドカーあり"
                      : "⚠ .gguf.json サイドカーが見つかりません（モデルの横に置いてください）"}
                  </div>
                )}
                {need > 0 && free !== undefined && (
                  <div className={free > need * 1.1 ? "ok-text" : "warn-text"}>
                    必要VRAM 目安 {gib(need * 1.1)}（ファイル {gib(need)} + 作業領域） / 空き {gib(free)}
                    {free <= need * 1.1 && " — 一部のエキスパートが CPU で計算され遅くなります"}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Page>
  );
}

export function InstallButton() {
  const installing = useApp((s) => s.installing);
  return (
    <button
      className="small"
      disabled={installing}
      onClick={() => useApp.getState().installSpeech()}
      title="GitHub の公式リリースから zip を取得し、SHA256SUMS で検証して展開します"
    >
      {installing ? "ダウンロード中…" : "⤓ speech.cpp をダウンロード（公式・SHA検証）"}
    </button>
  );
}
