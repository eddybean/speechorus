// One <audio> element for all playback. Every play button belongs to a "session" (its own key):
// ▶ starts it, ⏸ pauses it, ▶ again resumes from the same point — in the middle of a take or of the
// silence between lines. Starting another session stops the previous one and drops its position.
import { create } from "zustand";
import { fileUrl } from "./ipc";

export interface PlayItem {
  path: string;
  /** Silence before (not for the first item) and after, in seconds. */
  pre: number;
  post: number;
  /** What is playing now, for highlighting (a line or take id). */
  key: string;
  /** Play only [start, end) seconds of the file. */
  start?: number;
  end?: number;
}

interface PlayerState {
  /** The item playing (or paused) now. */
  playingKey: string | null;
  /** The button (session) that started the playback; null when idle. */
  sessionKey: string | null;
  paused: boolean;
  play: (items: PlayItem[], sessionKey?: string) => void;
  pause: () => void;
  resume: () => void;
  /** Stops and forgets the position. */
  stop: () => void;
  /** Pauses or resumes `sessionKey` when it is the current one, else plays `items()` as that session. */
  toggle: (sessionKey: string, items: () => PlayItem[]) => void;
}

/** The highest slider position: 200%. */
export const MAX_VOLUME = 2;

let audio: HTMLAudioElement | null = null;
let gain = 1;

/**
 * Above 100% the element's own `volume` (at most 1) is not enough, so the element plays through Web Audio:
 * element → gain → (limiter, only while boosting) → speakers. Without Web Audio the volume tops out at 100%.
 */
interface Graph {
  ctx: AudioContext;
  gain: GainNode;
  limiter: DynamicsCompressorNode;
  limiting: boolean;
}
let graph: Graph | null = null;

function el(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
    graph = connectGraph(audio);
    applyGain();
  }
  return audio;
}

function connectGraph(a: HTMLAudioElement): Graph | null {
  const Ctx = globalThis.AudioContext;
  if (!Ctx) return null;
  try {
    // The asset protocol answers with Access-Control-Allow-Origin, so the samples are readable (not muted).
    a.crossOrigin = "anonymous";
    const ctx = new Ctx();
    const g = ctx.createGain();
    // A hard limiter just under full scale: it touches only the peaks that boosting would clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    ctx.createMediaElementSource(a).connect(g);
    g.connect(ctx.destination);
    limiter.connect(ctx.destination);
    return { ctx, gain: g, limiter, limiting: false };
  } catch {
    a.removeAttribute("crossorigin");
    return null;
  }
}

function applyGain() {
  if (!audio) return;
  if (!graph) {
    audio.volume = Math.min(1, gain);
    return;
  }
  audio.volume = 1;
  graph.gain.gain.value = gain;
  // The limiter (with its small make-up gain) stays out of the path at 100% and below.
  const limit = gain > 1;
  if (limit !== graph.limiting) {
    graph.gain.disconnect();
    graph.gain.connect(limit ? graph.limiter : graph.ctx.destination);
    graph.limiting = limit;
  }
}

/** A context made outside a click starts suspended: wake it when playback starts. */
function wake() {
  if (graph?.ctx.state === "suspended") void graph.ctx.resume();
}

/**
 * The gain for a slider position (0 to MAX_VOLUME). Up to 100% it is squared, so that equal slider steps sound
 * like equal steps; above it rises in a straight line to 2× (+6 dB) at 200%.
 */
export function volumeGain(volume: number, muted: boolean): number {
  if (muted) return 0;
  const v = Number.isFinite(volume) ? Math.min(MAX_VOLUME, Math.max(0, volume)) : 1;
  return v <= 1 ? v * v : v;
}

/** Sets the volume of all playback (the one element), at once and for what plays next. */
export function setOutputVolume(volume: number, muted: boolean) {
  gain = volumeGain(volume, muted);
  applyGain();
}

/** Where the current session is: playing item `index`, or waiting `remaining` ms before calling `then`. */
type Phase = { kind: "audio"; index: number } | { kind: "gap"; until: number; remaining: number; then: () => void };

let run = 0;
let items: PlayItem[] = [];
let phase: Phase | null = null;
let gapTimer: ReturnType<typeof setTimeout> | null = null;
let rangeWatch: ReturnType<typeof setInterval> | null = null;

function clearTimers() {
  if (gapTimer) clearTimeout(gapTimer);
  if (rangeWatch) clearInterval(rangeWatch);
  gapTimer = null;
  rangeWatch = null;
}

export const usePlayer = create<PlayerState>()((set, get) => {
  const finish = () => {
    clearTimers();
    phase = null;
    items = [];
    set({ playingKey: null, sessionKey: null, paused: false });
  };

  /** Waits `ms` (pausable), then runs `then`. */
  const gap = (ms: number, then: () => void) => {
    const my = run;
    const wait = Math.max(0, ms);
    phase = { kind: "gap", until: Date.now() + wait, remaining: wait, then };
    gapTimer = setTimeout(() => {
      if (my === run && !get().paused) then();
    }, wait);
  };

  const watchRange = (end: number | undefined, onEnd: () => void) => {
    if (rangeWatch) clearInterval(rangeWatch);
    rangeWatch = null;
    if (end === undefined) return;
    const a = el();
    rangeWatch = setInterval(() => {
      if (a.currentTime >= end) {
        a.pause();
        onEnd();
      }
    }, 25);
  };

  const afterItem = (i: number) => {
    clearTimers();
    const it = items[i];
    const next = items[i + 1];
    if (!next) {
      gap(it.post * 1000, finish);
      return;
    }
    // The silence after this line and before the next one is one pausable wait.
    gap((it.post + next.pre) * 1000, () => startItem(i + 1));
  };

  const startItem = (i: number) => {
    const my = run;
    const it = items[i];
    phase = { kind: "audio", index: i };
    set({ playingKey: it.key });
    const a = el();
    a.onended = () => my === run && afterItem(i);
    a.onerror = () => my === run && afterItem(i);
    a.onloadedmetadata = () => {
      if (it.start) a.currentTime = it.start;
    };
    a.src = fileUrl(it.path);
    watchRange(it.end, () => my === run && afterItem(i));
    wake();
    void a.play().catch(() => my === run && afterItem(i));
  };

  const stop = () => {
    run++;
    clearTimers();
    phase = null;
    items = [];
    const a = el();
    a.onended = null;
    a.onerror = null;
    a.onloadedmetadata = null;
    a.pause();
    a.removeAttribute("src");
    a.load();
    set({ playingKey: null, sessionKey: null, paused: false });
  };

  const pause = () => {
    if (!get().sessionKey || get().paused || !phase) return;
    if (phase.kind === "audio") {
      el().pause();
      if (rangeWatch) clearInterval(rangeWatch);
      rangeWatch = null;
    } else {
      if (gapTimer) clearTimeout(gapTimer);
      gapTimer = null;
      phase = { ...phase, remaining: Math.max(0, phase.until - Date.now()) };
    }
    set({ paused: true });
  };

  const resume = () => {
    if (!get().sessionKey || !get().paused || !phase) return;
    set({ paused: false });
    if (phase.kind === "audio") {
      const i = phase.index;
      const my = run;
      watchRange(items[i].end, () => my === run && afterItem(i));
      wake();
      void el()
        .play()
        .catch(() => my === run && afterItem(i));
    } else {
      gap(phase.remaining, phase.then);
    }
  };

  return {
    playingKey: null,
    sessionKey: null,
    paused: false,
    stop,
    pause,
    resume,
    play: (list, sessionKey) => {
      stop();
      if (!list.length) return;
      items = list;
      set({ sessionKey: sessionKey ?? list[0].key, paused: false });
      startItem(0);
    },
    toggle: (sessionKey, getItems) => {
      const s = get();
      if (s.sessionKey === sessionKey) {
        if (s.paused) resume();
        else pause();
        return;
      }
      get().play(getItems(), sessionKey);
    },
  };
});
