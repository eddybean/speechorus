// Voice library: reference WAV → automatic transcription → `speech voice` → .voice.gguf.
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ipc } from "../../lib/ipc";
import { usePlayer } from "../../lib/player";
import type { Voice } from "../../lib/types";
import { useApp } from "../../store/app";
import { Dialog } from "../../app/Dialog";

interface Ref {
  path: string;
  transcript: string;
  busy: boolean;
}

export function VoiceLibrary() {
  const voices = useApp((s) => s.voices);
  const adapter = useApp((s) => s.activeAdapter());
  const profile = useApp((s) => s.activeProfile());
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [refs, setRefs] = useState<Ref[]>([]);
  const [creating, setCreating] = useState(false);
  const needsText = !!adapter?.capabilities.voiceNeedsTranscript;
  const app = useApp.getState;

  const transcribe = async (i: number, path: string) => {
    setRefs((r) => r.map((x, j) => (j === i ? { ...x, busy: true } : x)));
    try {
      const t = await ipc.voiceTranscribe(path);
      setRefs((r) => r.map((x, j) => (j === i ? { ...x, transcript: t, busy: false } : x)));
    } catch (e) {
      app().notify("error", `書き起こしに失敗: ${e}`);
      setRefs((r) => r.map((x, j) => (j === i ? { ...x, busy: false } : x)));
    }
  };

  const addRefs = async () => {
    const sel = await open({ multiple: true, filters: [{ name: "WAV", extensions: ["wav"] }] });
    const paths = (Array.isArray(sel) ? sel : sel ? [sel] : []).map(String);
    if (!paths.length) return;
    const start = refs.length;
    setRefs((r) => [...r, ...paths.map((p) => ({ path: p, transcript: "", busy: needsText }))]);
    if (!name) setName(paths[0].split(/[\\/]/).pop()!.replace(/\.wav$/i, ""));
    for (const [k, p] of paths.entries()) {
      await ipc.allowFile(p);
      if (needsText) await transcribe(start + k, p);
    }
  };

  const create = async () => {
    if (!profile) return;
    setCreating(true);
    try {
      const v = await ipc.voiceCreate(
        profile.id,
        name.trim() || "voice",
        refs.map((r) => ({ path: r.path, transcript: r.transcript.trim() || null, speaker: null })),
        note,
      );
      await app().refreshVoices();
      app().notify("info", `ボイス「${v.name}」を作成しました`);
      setRefs([]);
      setName("");
      setNote("");
    } catch (e) {
      app().notify("error", `ボイスを作成できません: ${e}`);
    } finally {
      setCreating(false);
    }
  };

  const canCreate = refs.length > 0 && !creating && refs.every((r) => !r.busy && (!needsText || r.transcript.trim()));
  return (
    <Dialog title="ボイスライブラリ" onClose={() => app().openDialog(null)} wide>
      <section>
        <h3>新しいボイス（{adapter?.displayName ?? "-"} 用）</h3>
        <p className="muted">
          参照音声（WAV、数秒〜30秒程度）を選ぶと{needsText ? "自動で書き起こします。誤りがあれば直してから" : ""}「作成」で .voice.gguf を作ります（CPUで数秒、モデル全体は読み込みません）。
        </p>
        <div className="grid2">
          <label>
            名前
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            メモ
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        {refs.map((r, i) => (
          <div key={r.path + i} className="ref">
            <button onClick={() => usePlayer.getState().play([{ path: r.path, pre: 0, post: 0, key: r.path }])}>▶</button>
            <span className="path" title={r.path}>
              {r.path.split(/[\\/]/).pop()}
            </span>
            <textarea
              rows={2}
              placeholder={needsText ? (r.busy ? "書き起こし中…" : "書き起こし（必須）") : "書き起こし不要"}
              value={r.transcript}
              disabled={r.busy || !needsText}
              onChange={(e) => setRefs((x) => x.map((y, j) => (j === i ? { ...y, transcript: e.target.value } : y)))}
            />
            {needsText && (
              <button disabled={r.busy} onClick={() => transcribe(i, r.path)} title="もう一度書き起こす">
                ASR
              </button>
            )}
            <button onClick={() => setRefs((x) => x.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <div className="row-buttons">
          <button onClick={addRefs}>参照音声を追加…</button>
          <button className="primary" disabled={!canCreate} onClick={create}>
            {creating ? "作成中…" : "作成"}
          </button>
        </div>
      </section>
      {adapter?.capabilities.multiSpeaker && <CastVoiceComposer />}
      <section>
        <h3>ボイス一覧</h3>
        <table className="voices">
          <thead>
            <tr>
              <th>名前</th>
              <th>モデル</th>
              <th>話者</th>
              <th>参照</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {voices.map((v) => (
              <VoiceRow key={v.id} v={v} />
            ))}
            {voices.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  まだボイスがありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </Dialog>
  );
}

function VoiceRow({ v }: { v: Voice }) {
  const app = useApp.getState;
  const [name, setName] = useState(v.name);
  return (
    <tr>
      <td>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== v.name && ipc.voiceUpdate({ ...v, name }).then(() => app().refreshVoices())} />
        {v.note && <div className="muted small-text">{v.note}</div>}
      </td>
      <td>{v.family}</td>
      <td>{v.speakers}</td>
      <td>
        {v.sources.map((s, i) => (
          <button key={i} title={s.transcript ?? ""} onClick={() => usePlayer.getState().play([{ path: s.path, pre: 0, post: 0, key: s.path }])}>
            ▶{i + 1}
          </button>
        ))}
        {v.combinedFrom.length > 0 && <span className="muted">合成</span>}
      </td>
      <td>
        <button
          className="danger"
          onClick={async () => {
            if (!confirm(`ボイス「${v.name}」を削除しますか？`)) return;
            await ipc.voiceDelete(v.id);
            await app().refreshVoices();
          }}
        >
          削除
        </button>
      </td>
    </tr>
  );
}

/** A multi-speaker voice put together by hand: speaker N is the voice in slot N (`speech voice … --speaker N`). */
function CastVoiceComposer() {
  const voices = useApp((s) => s.voices);
  const adapter = useApp((s) => s.activeAdapter());
  const profile = useApp((s) => s.activeProfile());
  const [slots, setSlots] = useState<(string | null)[]>([null, null]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const singles = voices.filter((v) => v.family === adapter?.id && v.speakers === 1 && v.combinedFrom.length === 0);
  const app = useApp.getState;
  const create = async () => {
    if (!profile) return;
    setBusy(true);
    try {
      const v = await ipc.voiceCombine(profile.id, slots, name || undefined);
      await app().refreshVoices();
      if (v) app().notify("info", `キャストボイス「${v.name}」（${v.speakers}話者）を作成しました`);
      setSlots([null, null]);
      setName("");
    } catch (e) {
      app().notify("error", `キャストボイスを作成できません: ${e}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <h3>キャストボイス（複数話者）を作成</h3>
      <p className="muted">話者番号ごとにボイスを割り当てて1つのボイスファイルにまとめます。台本では {"<|speaker:N|>"} で話者を指定します（「なし」の話者はモデルにおまかせ）。</p>
      {slots.map((id, n) => (
        <div key={n} className="slot">
          <span className="tok-speaker">{`<|speaker:${n}|>`}</span>
          <select value={id ?? ""} onChange={(e) => setSlots((s) => s.map((x, j) => (j === n ? e.target.value || null : x)))}>
            <option value="">（なし）</option>
            {singles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          {slots.length > 1 && (
            <button onClick={() => setSlots((s) => s.filter((_, j) => j !== n))} title="この話者を外す">
              ✕
            </button>
          )}
        </div>
      ))}
      <div className="row-buttons">
        <button disabled={slots.length >= 16} onClick={() => setSlots((s) => [...s, null])}>
          ＋ 話者
        </button>
        <input placeholder="名前（省略可）" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="primary" disabled={busy || slots.every((s) => !s)} onClick={create}>
          {busy ? "作成中…" : "作成"}
        </button>
      </div>
    </section>
  );
}
