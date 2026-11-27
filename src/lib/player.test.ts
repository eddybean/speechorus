import { beforeEach, describe, expect, it, vi } from "vitest";
import { setOutputVolume, usePlayer, volumeGain } from "./player";

// jsdom has no media playback: a minimal Audio stand-in that records what it was asked to do.
class FakeAudio {
  static last: FakeAudio | null = null;
  constructor() {
    FakeAudio.last = this;
  }
  src = "";
  currentTime = 0;
  preload = "";
  paused = true;
  volume = 1;
  crossOrigin: string | null = null;
  plays = 0;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onloadedmetadata: (() => void) | null = null;
  play() {
    this.paused = false;
    this.plays++;
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

const a = () => FakeAudio.last!;
const p = usePlayer.getState;
const item = (key: string, pre = 0, post = 0) => ({ path: `${key}.wav`, pre, post, key });

beforeEach(() => {
  vi.stubGlobal("Audio", FakeAudio);
  vi.useFakeTimers();
  usePlayer.getState().stop();
});

describe("player", () => {
  it("pauses and resumes from the same point, then returns to idle at the end", () => {
    p().toggle("line:a", () => [item("a")]);
    expect(p().sessionKey).toBe("line:a");
    expect(a().paused).toBe(false);
    a().currentTime = 1.25;
    p().toggle("line:a", () => []);
    expect(p().paused).toBe(true);
    expect(a().paused).toBe(true);
    p().toggle("line:a", () => []);
    expect(p().paused).toBe(false);
    expect(a().paused).toBe(false);
    expect(a().currentTime).toBe(1.25);
    expect(a().src).toBe("a.wav");
    a().onended!();
    vi.advanceTimersByTime(1);
    expect(p().sessionKey).toBeNull();
    // Next press plays from the start.
    p().toggle("line:a", () => [item("a")]);
    expect(p().sessionKey).toBe("line:a");
  });

  it("starting another session stops the previous one and drops its position", () => {
    p().toggle("line:a", () => [item("a")]);
    p().toggle("line:a", () => []);
    expect(p().paused).toBe(true);
    p().toggle("take:b", () => [item("b")]);
    expect(p().sessionKey).toBe("take:b");
    expect(p().paused).toBe(false);
    expect(a().src).toBe("b.wav");
    // Back to a: a fresh start, not a resume.
    p().toggle("line:a", () => [item("a")]);
    expect(p().sessionKey).toBe("line:a");
    expect(a().src).toBe("a.wav");
  });

  it("pauses in the silence between lines and resumes with the time left", () => {
    p().play([item("a", 0, 0.3), item("b", 0.2, 0)], "sequence");
    a().onended!();
    // In the 0.5 s gap (0.3 after a + 0.2 before b): pause after 200 ms.
    vi.advanceTimersByTime(200);
    p().pause();
    vi.advanceTimersByTime(5000);
    expect(p().playingKey).toBe("a");
    expect(a().src).toBe("a.wav");
    p().resume();
    vi.advanceTimersByTime(250);
    expect(a().src).toBe("a.wav");
    vi.advanceTimersByTime(60);
    expect(a().src).toBe("b.wav");
    expect(p().playingKey).toBe("b");
    a().onended!();
    vi.advanceTimersByTime(1);
    expect(p().sessionKey).toBeNull();
  });

  it("continues with the next lines after resuming in the middle of a line", () => {
    p().play([item("a"), item("b"), item("c")], "sequence");
    a().onended!();
    vi.advanceTimersByTime(1);
    expect(a().src).toBe("b.wav");
    p().pause();
    p().resume();
    a().onended!();
    vi.advanceTimersByTime(1);
    expect(a().src).toBe("c.wav");
  });

  it("stop forgets everything", () => {
    p().play([item("a"), item("b")], "sequence");
    p().pause();
    p().stop();
    expect(p().sessionKey).toBeNull();
    expect(p().paused).toBe(false);
    p().resume();
    expect(p().sessionKey).toBeNull();
  });
});

describe("playback volume", () => {
  it("squares the slider up to 100%, rises straight to 2× at 200%, clamps, and is silent when muted", () => {
    expect(volumeGain(1, false)).toBe(1);
    expect(volumeGain(0.5, false)).toBe(0.25);
    expect(volumeGain(0, false)).toBe(0);
    expect(volumeGain(1.5, false)).toBe(1.5);
    expect(volumeGain(2, false)).toBe(2);
    expect(volumeGain(3, false)).toBe(2);
    expect(volumeGain(-1, false)).toBe(0);
    expect(volumeGain(0.8, true)).toBe(0);
    // An old settings file without the field plays at full volume, not silently.
    expect(volumeGain(Number.NaN, false)).toBe(1);
  });

  it("changes the element at once, also in the middle of playback", () => {
    p().play([item("a")]);
    setOutputVolume(0.5, false);
    expect(a().volume).toBe(0.25);
    setOutputVolume(0.5, true);
    expect(a().volume).toBe(0);
    setOutputVolume(1, false);
    expect(a().volume).toBe(1);
  });

  it("tops out at 100% when there is no Web Audio", () => {
    p().play([item("a")]);
    setOutputVolume(2, false);
    expect(a().volume).toBe(1);
  });

  it("boosts through a gain node and puts the limiter in the path only above 100%", async () => {
    const log: string[] = [];
    class Node {
      constructor(public name: string) {}
      connect(to: Node | { name: string }) {
        log.push(`${this.name}→${to.name}`);
        return to;
      }
      disconnect() {
        log.push(`${this.name}×`);
      }
    }
    const param = () => ({ value: 0 });
    class FakeContext {
      static last: FakeContext;
      state = "suspended";
      destination = { name: "out" };
      gainNode = Object.assign(new Node("gain"), { gain: param() });
      resumed = 0;
      constructor() {
        FakeContext.last = this;
      }
      createGain() {
        return this.gainNode;
      }
      createDynamicsCompressor() {
        return Object.assign(new Node("limiter"), {
          threshold: param(),
          knee: param(),
          ratio: param(),
          attack: param(),
          release: param(),
        });
      }
      createMediaElementSource() {
        return new Node("element");
      }
      resume() {
        this.resumed++;
        this.state = "running";
        return Promise.resolve();
      }
    }
    vi.stubGlobal("AudioContext", FakeContext);
    vi.resetModules();
    const fresh = await import("./player");
    fresh.setOutputVolume(1.5, false);
    fresh.usePlayer.getState().play([item("a")]);
    const ctx = FakeContext.last;
    expect(a().crossOrigin).toBe("anonymous");
    expect(a().volume).toBe(1);
    expect(ctx.gainNode.gain.value).toBe(1.5);
    expect(log).toEqual(["element→gain", "gain→out", "limiter→out", "gain×", "gain→limiter"]);
    expect(ctx.resumed).toBe(1);
    log.length = 0;
    fresh.setOutputVolume(0.5, false);
    expect(ctx.gainNode.gain.value).toBe(0.25);
    expect(log).toEqual(["gain×", "gain→out"]);
    log.length = 0;
    fresh.setOutputVolume(0.8, false);
    expect(log).toEqual([]);
    fresh.usePlayer.getState().stop();
    vi.unstubAllGlobals();
  });
});
