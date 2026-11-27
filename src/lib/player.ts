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

let audio: HTMLAudioElement | null = null;
let gain = 1;

function el(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
    audio.volume = gain;
  }
  return audio;
}

/** The element gain for a slider position: squared, so that equal slider steps sound like equal steps. */
export function volumeGain(volume: number, muted: boolean): number {
  if (muted) return 0;
  const v = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1;
  return v * v;
}

/** Sets the volume of all playback (the one element), at once and for what plays next. */
export function setOutputVolume(volume: number, muted: boolean) {
  gain = volumeGain(volume, muted);
  if (audio) audio.volume = gain;
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
