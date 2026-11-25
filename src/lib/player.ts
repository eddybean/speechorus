// One <audio> element for all playback; sequences insert each line's silences with timers.
import { create } from "zustand";
import { fileUrl } from "./ipc";

export interface PlayItem {
  path: string;
  pre: number;
  post: number;
  /** What is playing, for the UI to highlight (a line or scene id). */
  key: string;
}

interface PlayerState {
  playingKey: string | null;
  play: (items: PlayItem[]) => void;
  stop: () => void;
}

let audio: HTMLAudioElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let runId = 0;

function el(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
  }
  return audio;
}

export const usePlayer = create<PlayerState>()((set) => {
  const stop = () => {
    runId++;
    if (timer) clearTimeout(timer);
    timer = null;
    const a = el();
    a.pause();
    a.removeAttribute("src");
    a.load();
    set({ playingKey: null });
  };
  return {
    playingKey: null,
    stop,
    play: (items) => {
      stop();
      const my = runId;
      const step = (i: number) => {
        if (my !== runId) return;
        if (i >= items.length) {
          set({ playingKey: null });
          return;
        }
        const it = items[i];
        set({ playingKey: it.key });
        timer = setTimeout(() => {
          if (my !== runId) return;
          const a = el();
          a.onended = () => {
            timer = setTimeout(() => step(i + 1), Math.max(0, it.post) * 1000);
          };
          a.onerror = () => step(i + 1);
          a.src = fileUrl(it.path);
          void a.play().catch(() => step(i + 1));
        }, i === 0 ? 0 : Math.max(0, it.pre) * 1000);
      };
      step(0);
    },
  };
});
