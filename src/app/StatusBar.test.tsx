import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { StatusBar, downloadSummary, formatEta } from "./StatusBar";
import { useApp } from "../store/app";
import type { AppSettings, DownloadProgress } from "../lib/types";

const cancelAll = vi.fn(async () => {});
const settings: AppSettings = {
  version: 1,
  profiles: [
    {
      id: "p1",
      name: "Irodori Small",
      adapter: "irodori",
      model: "/m",
      speechExe: "s",
      device: "auto",
      threads: null,
      env: {},
      extraArgs: [],
    },
  ],
  activeProfileId: "p1",
  speechExe: "s",
  asrModel: "",
  asrDevice: "auto",
  showNsfwTags: false,
  theme: "dark",
  recentTags: [],
  recentProjects: [],
  playbackVolume: 1,
  playbackMuted: false,
  memoryGuard: "standard",
};

describe("formatEta", () => {
  it("shows seconds under a minute and minutes above", () => {
    expect(formatEta(11.2)).toBe("約12秒");
    expect(formatEta(125)).toBe("約2分5秒");
  });
});

describe("StatusBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useApp.setState({
      settings,
      cancelAll,
      jobs: {},
      jobOrder: [],
      jobDurations: [],
      runningSince: null,
      engine: { state: "ready", profileId: "p1", model: {}, sampleRate: 48000 },
      downloads: {},
      engineStarting: null,
    });
  });

  it("shows the loaded model when nothing is queued", () => {
    render(<StatusBar />);
    expect(screen.getByText(/Irodori Small/).textContent).toContain("48 kHz");
    expect(screen.queryByRole("button", { name: /中止/ })).toBeNull();
  });

  it("shows the queue with the running job and lets it be cancelled", () => {
    useApp.setState({
      jobs: {
        j1: { lineId: "a", sceneId: null, status: "running", seconds: 2.4 },
        j2: { lineId: "b", sceneId: null, status: "queued", seconds: 0 },
      },
      jobOrder: ["j1", "j2"],
    });
    render(<StatusBar />);
    expect(screen.getByText(/残り 2 件/).textContent).toContain("2.4s");
    fireEvent.click(screen.getByRole("button", { name: /中止/ }));
    expect(cancelAll).toHaveBeenCalled();
  });

  it("points to the model catalog when the chosen profile has no model", () => {
    useApp.setState({
      engine: { state: "stopped" },
      dialog: null,
      settings: { ...settings, profiles: [{ ...settings.profiles[0], model: "" }] },
    });
    render(<StatusBar />);
    expect(screen.getByText(/Irodori Small のモデルが未設定です/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "モデルを入手…" }));
    expect(useApp.getState().dialog).toBe("catalog");
  });

  it("keeps the usual hint when the stopped profile has a model", () => {
    useApp.setState({ engine: { state: "stopped" } });
    render(<StatusBar />);
    expect(screen.getByText(/エンジン停止中/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /モデルを入手/ })).toBeNull();
  });

  it("shows a running download anywhere in the app and opens its dialog (D-59)", () => {
    useApp.setState({ dialog: null, downloads: { [dl.id]: dl } });
    render(<StatusBar />);
    fireEvent.click(screen.getByRole("button", { name: /irodori-tts-large:q8_0 25%・残り 3分0秒/ }));
    expect(useApp.getState().dialog).toBe("catalog");
  });

  it("says the start is being prepared before the engine reports loading", () => {
    useApp.setState({ engine: { state: "stopped" }, engineStarting: "p1" });
    render(<StatusBar />);
    expect(screen.getByText("Irodori Small の起動を準備中…")).toBeTruthy();
  });
});

const dl: DownloadProgress = {
  id: "irodori-tts-large:q8_0",
  phase: "downloading",
  file: "",
  done: 1e9,
  total: 4e9,
  bytesPerSec: 1e7,
  etaSecs: 180,
  message: "",
  profileId: null,
};

describe("downloadSummary", () => {
  it("names the first running download and counts the rest; finished ones are left out", () => {
    expect(downloadSummary({})).toBeNull();
    expect(downloadSummary({ a: { ...dl, phase: "done" } })).toBeNull();
    const two = { a: dl, b: { ...dl, id: "qwen3-asr-0.6b:q8_0", phase: "verifying" as const } };
    expect(downloadSummary(two)).toBe("irodori-tts-large:q8_0 25%・残り 3分0秒（ほか 1 件）");
    expect(downloadSummary({ b: two.b })).toBe("qwen3-asr-0.6b:q8_0 検証中");
  });
});
