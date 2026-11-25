import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayer } from "./player";

// jsdom has no media playback: a minimal Audio stand-in.
class FakeAudio {
  static last: FakeAudio | null = null;
  constructor() {
    FakeAudio.last = this;
  }
  src = "";
  currentTime = 0;
  preload = "";
  paused = true;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onloadedmetadata: (() => void) | null = null;
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  load() {}
  removeAttribute() {
    this.src = "";
  }
}

beforeEach(() => {
  vi.stubGlobal("Audio", FakeAudio);
  usePlayer.getState().stop();
});

describe("player toggle", () => {
  it("toggles a session and lets another session take over", () => {
    vi.useFakeTimers();
    const p = usePlayer.getState;
    p().toggle("line:a", () => [{ path: "a.wav", pre: 0, post: 0, key: "a" }]);
    vi.advanceTimersByTime(1);
    expect(p().sessionKey).toBe("line:a");
    expect(p().playingKey).toBe("a");
    // Another button: the first one stops showing as playing.
    p().toggle("take:b", () => [{ path: "b.wav", pre: 0, post: 0, key: "b" }]);
    vi.advanceTimersByTime(1);
    expect(p().sessionKey).toBe("take:b");
    // Same button again: stop.
    expect(p().toggle("take:b", () => [])).toBe(false);
    expect(p().sessionKey).toBeNull();
    expect(p().playingKey).toBeNull();
    vi.useRealTimers();
  });

  it("returns to idle when the last item ends", () => {
    vi.useFakeTimers();
    const p = usePlayer.getState;
    p().play([{ path: "a.wav", pre: 0, post: 0.1, key: "a" }], "seq");
    vi.advanceTimersByTime(1);
    expect(p().sessionKey).toBe("seq");
    FakeAudio.last!.onended!();
    vi.advanceTimersByTime(150);
    expect(p().sessionKey).toBeNull();
    expect(p().playingKey).toBeNull();
    vi.useRealTimers();
  });
});
