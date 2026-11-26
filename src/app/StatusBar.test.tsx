import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { StatusBar, formatEta } from "./StatusBar";
import { useApp } from "../store/app";
import type { AppSettings } from "../lib/types";

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
});
