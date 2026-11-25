// One <audio> element for all playback. Every play button is a toggle: it starts a "session"
// (its own key) and shows stop while that session plays; starting another session stops the previous one.
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
  /** The item playing now. */
  playingKey: string | null;
  /** The button (session) that started the playback. */
  sessionKey: string | null;
  play: (items: PlayItem[], sessionKey?: string) => void;
  stop: () => void;
  /** Stops when `sessionKey` is playing, else plays `items()` as that session. */
  toggle: (sessionKey: string, items: () => PlayItem[]) => boolean;
}

let audio: HTMLAudioElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let rangeWatch: ReturnType<typeof setInterval> | null = null;
let runId = 0;

function el(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
  }
  return audio;
}

function clearTimers() {
  if (timer) clearTimeout(timer);
  if (rangeWatch) clearInterval(rangeWatch);
  timer = null;
  rangeWatch = null;
}

export const usePlayer = create<PlayerState>()((set, get) => {
  const stop = () => {
    runId++;
    clearTimers();
    const a = el();
    a.onended = null;
    a.onerror = null;
    a.onloadedmetadata = null;
    a.pause();
    a.removeAttribute("src");
    a.load();
    set({ playingKey: null, sessionKey: null });
  };
  const play = (items: PlayItem[], sessionKey?: string) => {
    stop();
    if (!items.length) return;
    const my = runId;
    set({ sessionKey: sessionKey ?? items[0].key });
    const step = (i: number) => {
      if (my !== runId) return;
      if (i >= items.length) {
        set({ playingKey: null, sessionKey: null });
        return;
      }
      const it = items[i];
      set({ playingKey: it.key });
      const next = () => {
        if (my !== runId) return;
        clearTimers();
        timer = setTimeout(() => step(i + 1), Math.max(0, it.post) * 1000);
      };
      timer = setTimeout(
        () => {
          if (my !== runId) return;
          const a = el();
          a.onended = next;
          a.onerror = () => step(i + 1);
          a.onloadedmetadata = () => {
            if (it.start) a.currentTime = it.start;
          };
          a.src = fileUrl(it.path);
          if (it.end !== undefined) {
            const end = it.end;
            rangeWatch = setInterval(() => {
              if (a.currentTime >= end) {
                a.pause();
                next();
              }
            }, 25);
          }
          void a.play().catch(() => step(i + 1));
        },
        i === 0 ? 0 : Math.max(0, it.pre) * 1000,
      );
    };
    step(0);
  };
  return {
    playingKey: null,
    sessionKey: null,
    stop,
    play,
    toggle: (sessionKey, items) => {
      if (get().sessionKey === sessionKey) {
        stop();
        return false;
      }
      play(items(), sessionKey);
      return true;
    },
  };
});
