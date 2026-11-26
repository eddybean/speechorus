// A reference recording's waveform (min/max peaks from the Rust side, drawn on a canvas) with a draggable
// start/end, playback of the chosen range, and a length guide.
import { useEffect, useRef, useState } from "react";
import { ipc } from "../../lib/ipc";
import { PlayButton } from "../../app/PlayButton";

/** The recommended length of a reference, and what to say about a range of `secs`. */
export const REF_MIN = 10;
export const REF_MAX = 30;
export function refLengthAdvice(secs: number): { level: "ok" | "warn"; text: string } {
  if (secs < 3)
    return {
      level: "warn",
      text: `短すぎます（${secs.toFixed(1)}秒）。声の特徴が十分に入りません。推奨は ${REF_MIN}〜${REF_MAX} 秒です。`,
    };
  if (secs < REF_MIN)
    return { level: "ok", text: `${secs.toFixed(1)}秒（推奨 ${REF_MIN}〜${REF_MAX} 秒。もう少し長いと安定します）` };
  if (secs <= REF_MAX) return { level: "ok", text: `${secs.toFixed(1)}秒（推奨範囲内）` };
  return {
    level: "warn",
    text: `長すぎます（${secs.toFixed(1)}秒）。推奨は ${REF_MIN}〜${REF_MAX} 秒です。長い参照は生成のたびにプロンプトを長くし、遅くなります。区間を選んで切り出してください。`,
  };
}

/** Moves the handle nearest to `t` there, keeping start < end by at least `minGap`. */
export function dragRange(
  start: number,
  end: number,
  t: number,
  which: "start" | "end",
  duration: number,
  minGap = 0.2,
): [number, number] {
  const x = Math.max(0, Math.min(duration, t));
  return which === "start" ? [Math.min(x, end - minGap), end] : [start, Math.max(x, start + minGap)];
}

interface Props {
  path: string;
  start: number;
  end: number;
  onChange: (start: number, end: number, duration: number) => void;
}

const W = 640;
const H = 72;

export function WaveformTrimmer({ path, start, end, onChange }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [wave, setWave] = useState<{ duration: number; peaks: [number, number][] } | null>(null);
  const [err, setErr] = useState("");
  const drag = useRef<"start" | "end" | null>(null);
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    let alive = true;
    ipc
      .wavPeaks(path, W)
      .then((w) => {
        if (!alive) return;
        setWave(w);
        if (end <= 0) cb.current(0, w.duration, w.duration);
      })
      .catch((e) => setErr(String(e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !wave) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = W * dpr;
    c.height = H * dpr;
    const g = c.getContext("2d")!;
    g.scale(dpr, dpr);
    const css = getComputedStyle(c);
    const fg = css.getPropertyValue("--accent").trim() || "#6aa8ff";
    const dim = css.getPropertyValue("--muted").trim() || "#888";
    g.clearRect(0, 0, W, H);
    const xs = (t: number) => (t / wave.duration) * W;
    g.fillStyle = "rgba(127,127,127,0.12)";
    g.fillRect(xs(start), 0, xs(end) - xs(start), H);
    wave.peaks.forEach(([lo, hi], i) => {
      const x = (i / wave.peaks.length) * W;
      const t = (i / wave.peaks.length) * wave.duration;
      g.fillStyle = t >= start && t <= end ? fg : dim;
      const y0 = H / 2 - hi * (H / 2);
      const y1 = H / 2 - lo * (H / 2);
      g.fillRect(x, y0, Math.max(1, W / wave.peaks.length - 0.3), Math.max(1, y1 - y0));
    });
    g.fillStyle = fg;
    for (const t of [start, end]) g.fillRect(xs(t) - 1, 0, 2, H);
  }, [wave, start, end]);

  if (err) return <div className="warn-text">波形を読めません: {err}</div>;
  if (!wave) return <div className="muted small-text">波形を読み込み中…</div>;

  const toTime = (clientX: number) => {
    const r = canvas.current!.getBoundingClientRect();
    return ((clientX - r.left) / r.width) * wave.duration;
  };
  const onDown = (e: React.PointerEvent) => {
    const t = toTime(e.clientX);
    drag.current = Math.abs(t - start) <= Math.abs(t - end) ? "start" : "end";
    (e.target as Element).setPointerCapture(e.pointerId);
    const [s, en] = dragRange(start, end, t, drag.current, wave.duration);
    onChange(s, en, wave.duration);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const [s, en] = dragRange(start, end, toTime(e.clientX), drag.current, wave.duration);
    onChange(s, en, wave.duration);
  };
  const advice = refLengthAdvice(end - start);
  return (
    <div className="trimmer">
      <canvas
        ref={canvas}
        style={{ width: "100%", maxWidth: W, height: H }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => (drag.current = null)}
        title="ドラッグで開始・終了を指定"
      />
      <div className="trim-info">
        <PlayButton
          session={`range:${path}`}
          items={() => [{ path, pre: 0, post: 0, key: `range:${path}`, start, end }]}
          title="選択区間を試聴"
          label="区間を試聴"
        />
        <span className="small-text">
          {start.toFixed(2)}s – {end.toFixed(2)}s / 全体 {wave.duration.toFixed(1)}s
        </span>
        <span className={advice.level === "warn" ? "warn-text" : "muted small-text"}>{advice.text}</span>
      </div>
    </div>
  );
}
