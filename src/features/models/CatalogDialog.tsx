// Model catalog: pick a model and a quantization, agree to its license, download (resumable, SHA-256 checked).
import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ipc, joinPath } from "../../lib/ipc";
import { useApp } from "../../store/app";
import { Dialog } from "../../app/Dialog";
import type { CatalogModel, CatalogView, DownloadProgress } from "../../lib/types";
import { fmtEta } from "../../lib/text";

const gib = (b: number) => (b / 2 ** 30).toFixed(1) + " GiB";

export function CatalogDialog() {
  const [view, setView] = useState<CatalogView | null>(null);
  const [err, setErr] = useState("");
  // Read again when a download finishes, so its variant shows as fetched.
  const finished = useApp((s) => Object.values(s.downloads).filter((d) => d.phase === "done").length);
  useEffect(() => {
    ipc
      .catalogList()
      .then(setView)
      .catch((e) => setErr(String(e)));
  }, [finished]);
  return (
    <Dialog title="モデルを入手" onClose={() => useApp.getState().openDialog(null)} wide>
      {err && <p className="warn-text">{err}</p>}
      {!view && !err && <p className="muted">読み込み中…</p>}
      {view && (
        <>
          <p className="muted">
            {view.gpu
              ? `GPU: ${view.gpu.name}（空き ${gib(view.gpu.free)} / ${gib(view.gpu.total)}）`
              : "GPU 情報を取得できません（speech.exe を設定してください）"}
            ・ダウンロードは中断しても続きから再開でき、SHA-256
            で検証されます。完了するとモデルプロファイルが作成・選択されます。
          </p>
          {view.catalog.models.map((m) => (
            <ModelCard key={m.id} m={m} rec={view.recommended[m.id]} defaultDir={view.defaultDir} />
          ))}
        </>
      )}
    </Dialog>
  );
}

function ModelCard({ m, rec, defaultDir }: { m: CatalogModel; rec?: string; defaultDir: string }) {
  // The catalog default (Q4_K for Drama-3) is preselected; the variant that fits the GPU best gets the 推奨 badge.
  const [variant, setVariant] = useState(m.defaultVariant);
  const [dir, setDir] = useState(joinPath(defaultDir, m.id));
  const [agreed, setAgreed] = useState(false);
  const id = `${m.id}:${variant}`;
  const prog = useApp((s) => s.downloads[id]) as DownloadProgress | undefined;
  const v = m.variants.find((x) => x.id === variant)!;
  const size = v.files.reduce((a, f) => a + f.size, 0);
  const running = prog && ["checking", "downloading", "verifying"].includes(prog.phase);
  const hf = m.source.kind === "huggingface";
  const start = async () => {
    try {
      await ipc.catalogDownload(m.id, variant, dir, agreed);
      useApp.setState((s) => ({
        downloads: {
          ...s.downloads,
          [id]: {
            ...(s.downloads[id] ?? {}),
            id,
            phase: "checking",
            file: "",
            done: 0,
            total: size,
            bytesPerSec: 0,
            etaSecs: null,
            message: "",
            profileId: null,
          },
        },
      }));
    } catch (e) {
      useApp.getState().notify("error", String(e));
    }
  };
  const pct = prog && prog.total ? Math.min(100, (prog.done / prog.total) * 100) : 0;
  return (
    <section className="catalog-card">
      <h3>
        {m.name}{" "}
        <span className="muted small-text">
          {m.task === "recognition" ? "書き起こし (ASR)" : `音声合成 / ${m.adapter}`}
        </span>
      </h3>
      <p className="muted small-text">{m.description}</p>
      <div className="variants">
        {m.variants.map((x) => (
          <label
            key={x.id}
            className={`variant${x.supported === false ? " unsupported" : ""}`}
            title={x.unsupportedReason}
          >
            <input
              type="radio"
              name={`v-${m.id}`}
              disabled={x.supported === false || !!running}
              checked={variant === x.id}
              onChange={() => setVariant(x.id)}
            />
            <span>
              {x.label}
              {rec === x.id && <span className="badge takes">推奨</span>}
              <br />
              <span className="muted small-text">
                {x.supported === false
                  ? `非対応: ${x.unsupportedReason}`
                  : `${gib(x.files.reduce((a, f) => a + f.size, 0))}・VRAM 目安 ${gib(x.vramBytes)}${x.fetched ? "・✓ 取得済" : ""}`}
              </span>
            </span>
          </label>
        ))}
      </div>
      {hf ? (
        <label className="block">
          保存先
          <span className="with-button">
            <input value={dir} disabled={!!running} onChange={(e) => setDir(e.target.value)} />
            <button
              disabled={!!running}
              onClick={async () => {
                const d = await open({ directory: true, defaultPath: dir });
                if (d) setDir(String(d));
              }}
            >
              …
            </button>
          </span>
        </label>
      ) : (
        <p className="muted small-text">
          speech.cpp の `speech pull` で speech.cpp のモデルフォルダに取得します（中断しても再開できます）。
        </p>
      )}
      <div className="license-box">
        <b>ライセンス: {m.license.name}</b>
        <pre>{m.license.summary}</pre>
        <span className="muted small-text">{m.license.url}</span>
        {m.license.requiresConsent && (
          <label>
            <input
              type="checkbox"
              checked={agreed}
              disabled={!!running}
              onChange={(e) => setAgreed(e.target.checked)}
            />{" "}
            ライセンスを読み、その条件に従って利用することに同意します
          </label>
        )}
      </div>
      {prog && (
        <div className="dl-progress">
          <div className="bar">
            <div style={{ width: `${pct}%` }} />
          </div>
          <span className="small-text">
            {phaseLabel(prog.phase)} {prog.file} {gib(prog.done)} / {gib(prog.total)}
            {prog.phase === "downloading" &&
              ` ・${(prog.bytesPerSec / 1e6).toFixed(1)} MB/s ・残り ${fmtEta(prog.etaSecs)}`}
            {prog.message && <div className={prog.phase === "failed" ? "warn-text" : "muted"}>{prog.message}</div>}
          </span>
        </div>
      )}
      <div className="row-buttons">
        {running ? (
          <button onClick={() => ipc.downloadCancel(id)}>■ キャンセル</button>
        ) : (
          <button
            className="primary"
            disabled={v.supported === false || (m.license.requiresConsent && !agreed)}
            onClick={start}
          >
            {v.fetched
              ? m.task === "recognition"
                ? "✓ 取得済 — 書き起こしモデルに設定"
                : "✓ 取得済 — このモデルのプロファイルを作成"
              : `⤓ ${prog?.phase === "cancelled" || prog?.phase === "failed" ? "再開" : "ダウンロード"}（${gib(size)}）`}
          </button>
        )}
      </div>
    </section>
  );
}

function phaseLabel(p: string) {
  return (
    {
      checking: "既存ファイルを確認中",
      downloading: "ダウンロード中",
      verifying: "SHA-256 検証中",
      done: "✓ 完了",
      failed: "失敗",
      cancelled: "中断",
    }[p] ?? p
  );
}
