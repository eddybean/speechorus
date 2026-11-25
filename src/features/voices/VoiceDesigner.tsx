// Voices from a description: (a) keep the description alone as a voice, or (b) generate a few candidates
// from it with different seeds, pick one by ear and fix it as a voice file (`speech voice` on that take,
// with the sample sentence as its transcript), so every later line has the same voice.
import { useEffect, useState } from "react";
import { ipc, joinPath } from "../../lib/ipc";
import { plainText, uid } from "../../lib/text";
import type { JobSpec } from "../../lib/types";
import { useApp } from "../../store/app";
import { useProject } from "../../store/project";
import { PlayButton } from "../../app/PlayButton";

export const DEFAULT_SAMPLE = "こんにちは。今日はよろしくお願いします。少し緊張していますが、最後まで精一杯がんばりますね。";

/** The jobs that make `n` candidates of a described voice, seeds base, base+1, … */
export function designJobs(prompt: string, sample: string, n: number, baseSeed: number, outDir: string): JobSpec[] {
  const stamp = Date.now().toString(36);
  return Array.from({ length: Math.max(1, n) }, (_, k) => ({
    jobId: uid(),
    lineId: null,
    sceneId: null,
    request: { text: sample, voice: null, voiceFamily: null, designPrompt: prompt, options: {}, seed: baseSeed + k },
    voicePath: null,
    outDir,
    fileStem: `design-${stamp}-${k}`,
  }));
}

/** The transcript of a candidate: what it said, i.e. the sample without its cues. */
export function designTranscript(sample: string): string {
  return plainText(sample);
}

/** Letters only, for comparing what was said with what was meant. */
function letters(s: string): string {
  return plainText(s).replace(/[\s、。，．,.!?！？「」『』（）()…ー〜~・:：;；"'”“’‘-]/g, "");
}

function lcs(a: string, b: string): number {
  const A = [...a];
  const B = [...b];
  let prev = new Array(B.length + 1).fill(0);
  for (const x of A) {
    const cur = [0];
    for (let j = 1; j <= B.length; j++) cur[j] = x === B[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[B.length];
}

/**
 * True when ASR likely heard the whole sample. ASR may write kana as kanji (がんばり → 頑張り), so this asks for
 * most of the sample's letters in order (LCS ≥ 75%) and for its last two letters at the end, which a take that
 * stopped early lacks.
 */
export function saidAll(asr: string, sample: string): boolean {
  const a = letters(asr);
  const s = letters(sample);
  if (!s) return true;
  if (!a) return false;
  const tail = [...s].slice(-2).join("");
  return lcs(a, s) / [...s].length >= 0.75 && a.slice(-6).includes(tail);
}

export function VoiceDesigner() {
  const adapter = useApp((s) => s.activeAdapter());
  const profile = useApp((s) => s.activeProfile());
  const engine = useApp((s) => s.engine);
  const design = useApp((s) => s.design);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [sample, setSample] = useState(DEFAULT_SAMPLE);
  const [count, setCount] = useState(4);
  const [busy, setBusy] = useState(false);
  const app = useApp.getState;
  const isIrodori = adapter?.capabilities.designPrompt === "instructions";
  const pending = Object.keys(design.jobs).length;
  const ready = engine.state === "ready" && adapter && engine.profileId === profile?.id;

  // Check each new candidate with ASR: a take that stopped early must not be fixed with the full sample as its transcript.
  useEffect(() => {
    const todo = design.candidates.find((c) => c.asr === undefined);
    if (!todo) return;
    let alive = true;
    ipc
      .voiceTranscribe(todo.path)
      .catch(() => "")
      .then((asr) => {
        if (!alive) return;
        useApp.setState((s) => ({ design: { ...s.design, candidates: s.design.candidates.map((c) => (c.path === todo.path ? { ...c, asr } : c)) } }));
      });
    return () => {
      alive = false;
    };
  }, [design.candidates]);

  const savePromptOnly = async () => {
    if (!adapter) return;
    try {
      const v = await ipc.voiceCreatePrompt(adapter.id, name.trim() || prompt.slice(0, 16), prompt);
      await app().refreshVoices();
      app().notify("info", `プロンプトのボイス「${v.name}」を登録しました（キャストに割り当てると生成時に説明が付きます）`);
    } catch (e) {
      app().notify("error", String(e));
    }
  };

  const makeCandidates = async () => {
    const dir = joinPath(useProject.getState().takesDir, "design");
    const jobs = designJobs(prompt.trim(), sample.trim(), count, Math.floor(Math.random() * 1e9), dir);
    useApp.setState((s) => ({ design: { candidates: s.design.candidates, jobs: { ...s.design.jobs, ...Object.fromEntries(jobs.map((j) => [j.jobId, dir])) } } }));
    await app().enqueue(jobs);
  };

  const fix = async (path: string, seed: number | null, asr?: string) => {
    if (!profile) return;
    if (asr !== undefined && !saidAll(asr, sample) && !confirm(`この候補は試し読みの文を最後まで読んでいない可能性があります（認識結果: 「${asr}」）。\n書き起こしと音声が食い違うとボイスの品質が下がります。それでも固定しますか？`)) return;
    setBusy(true);
    try {
      const v = await ipc.voiceCreate(
        profile.id,
        name.trim() || prompt.slice(0, 16),
        [{ path, transcript: adapter?.capabilities.voiceNeedsTranscript ? designTranscript(sample) : null, speaker: null }],
        `プロンプト: ${prompt.trim()} / シード ${seed ?? "?"}`,
      );
      await app().refreshVoices();
      app().notify("info", `ボイス「${v.name}」を作成しました（以降は同じ声で生成されます）`);
    } catch (e) {
      app().notify("error", `ボイスを作成できません: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h3>声の説明（プロンプト）からボイスを作る</h3>
      <p className="muted">
        {isIrodori ? "Irodori では説明を instructions として送ります。" : "Drama-3 では voice=none で、説明を本文の先頭に [..] として付けます。"}
        説明だけのボイスはシードごとに声が揺れます。候補を生成して1本選び「この声で固定」すると、その音声を参照にしたボイスファイルを作り、以降の声が一定になります。
      </p>
      <div className="grid2">
        <label>
          名前
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 落ち着いた女性" />
        </label>
        <label>
          候補の数
          <input type="number" min={1} max={8} value={count} onChange={(e) => setCount(Math.max(1, Math.min(8, Number(e.target.value))))} />
        </label>
      </div>
      <label className="block">
        声の説明
        <textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={isIrodori ? "落ち着いた女性の声で、近い距離感でやわらかく読み上げてください。" : "落ち着いた25歳の女性。親密な相手に耳元で優しく囁く。"} />
      </label>
      <label className="block">
        試し読みの文（固定するときの書き起こしになります）
        <textarea rows={2} value={sample} onChange={(e) => setSample(e.target.value)} />
      </label>
      <div className="row-buttons">
        <button disabled={!prompt.trim()} onClick={savePromptOnly} title="説明だけを登録（ファイルなし）">
          説明だけで登録
        </button>
        <button className="primary" disabled={!prompt.trim() || !sample.trim() || !ready || pending > 0} onClick={makeCandidates} title={ready ? "" : "エンジンを起動してください"}>
          {pending > 0 ? `生成中…（残り ${pending}）` : `候補を ${count} 本生成`}
        </button>
      </div>
      {!ready && <p className="muted small-text">候補の生成には、このモデルのエンジンを起動しておく必要があります。</p>}
      {design.candidates.length > 0 && (
        <ul className="takes">
          {design.candidates.map((c, i) => (
            <li key={c.take.id}>
              <PlayButton session={`design:${c.take.id}`} items={() => [{ path: c.path, pre: 0, post: 0, key: c.take.id }]} title="試聴" />
              <span className="take-name">候補 {i + 1}</span>
              <span className="muted">{c.take.duration.toFixed(1)}s</span>
              <span className="muted">🎲{c.take.seed ?? "?"}</span>
              {c.asr === undefined ? (
                <span className="muted small-text">確認中…</span>
              ) : saidAll(c.asr, sample) ? (
                <span className="ok-text small-text" title={c.asr}>
                  ✓ 全文
                </span>
              ) : (
                <span className="warn-text" title={`認識結果: ${c.asr}`}>
                  ⚠ 読み切れていない可能性
                </span>
              )}
              <span className="spacer" />
              <button className="primary" disabled={busy} onClick={() => fix(c.path, c.take.seed, c.asr)}>
                この声で固定
              </button>
            </li>
          ))}
          <li>
            <button className="small" onClick={() => useApp.setState((s) => ({ design: { ...s.design, candidates: [] } }))}>
              候補をクリア
            </button>
          </li>
        </ul>
      )}
    </section>
  );
}
