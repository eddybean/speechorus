import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Rail } from "./Rail";
import { useApp } from "../store/app";
import type { AppSettings, EngineState, ModelProfile } from "../lib/types";

const profile = (id: string, name: string, model = "/m.gguf"): ModelProfile => ({
  id,
  name,
  adapter: "irodori",
  model,
  speechExe: "speech",
  device: "auto",
  threads: null,
  env: {},
  extraArgs: [],
});
const settings = (active: string, p1Model = "/m.gguf"): AppSettings => ({
  version: 1,
  profiles: [profile("p1", "Irodori Small", p1Model), profile("p2", "Drama-3")],
  activeProfileId: active,
  speechExe: "speech",
  asrModel: "",
  asrDevice: "auto",
  showNsfwTags: false,
  theme: "dark",
  recentTags: [],
  recentProjects: [],
  playbackVolume: 1,
  playbackMuted: false,
  memoryGuard: "standard",
});

const startEngine = vi.fn(async () => {});
const stopEngine = vi.fn(async () => {});
const saveSettings = vi.fn(async () => {});

function setup(engine: EngineState, active = "p1", p1Model?: string) {
  useApp.setState({
    engine,
    settings: settings(active, p1Model),
    dialog: null,
    view: "script",
    castOpen: true,
    startEngine,
    stopEngine,
    saveSettings,
  });
  render(<Rail />);
}

describe("Rail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("toggles the cast panel", () => {
    setup({ state: "stopped" });
    const cast = screen.getByRole("button", { name: "キャスト" });
    expect(cast.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(cast);
    expect(useApp.getState().castOpen).toBe(false);
  });

  it("switches the main pane between the script, voices and models, and opens settings as a dialog", () => {
    setup({ state: "stopped" });
    const current = () => screen.getAllByRole("button").filter((b) => b.getAttribute("aria-current") === "page");
    expect(current().map((b) => b.textContent)).toEqual(["台本"]);
    fireEvent.click(screen.getByRole("button", { name: "ボイス" }));
    expect(useApp.getState().view).toBe("voices");
    expect(current().map((b) => b.textContent)).toEqual(["ボイス"]);
    fireEvent.click(screen.getByRole("button", { name: "モデル" }));
    expect(useApp.getState().view).toBe("models");
    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    expect(useApp.getState().dialog).toBe("settings");
    expect(useApp.getState().view).toBe("models");
    fireEvent.click(screen.getByRole("button", { name: "台本" }));
    expect(useApp.getState().view).toBe("script");
  });

  it("goes back to the script with the cast panel shown when キャスト is pressed on another screen", () => {
    setup({ state: "stopped" });
    act(() => useApp.setState({ view: "voices", castOpen: false }));
    const cast = screen.getByRole("button", { name: "キャスト" });
    expect(cast.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(cast);
    expect(useApp.getState()).toMatchObject({ view: "script", castOpen: true });
    expect(cast.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the engine state and starts the chosen profile from its panel", () => {
    setup({ state: "stopped" });
    fireEvent.click(screen.getByRole("button", { name: /エンジン: 停止中/ }));
    fireEvent.click(screen.getByRole("button", { name: "Irodori Small を起動" }));
    expect(startEngine).toHaveBeenCalledWith("p1");
  });

  it("stops a running engine, and offers to switch when another profile is chosen", () => {
    setup({ state: "ready", profileId: "p1", model: {}, sampleRate: 48000 });
    fireEvent.click(screen.getByRole("button", { name: /エンジン: 準備完了/ }));
    fireEvent.click(screen.getByRole("button", { name: "エンジンを停止" }));
    expect(stopEngine).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Drama-3/ }));
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ activeProfileId: "p2" }));
  });

  it("offers a switch when the chosen profile is not the running one", () => {
    setup({ state: "ready", profileId: "p1", model: {}, sampleRate: 48000 }, "p2");
    fireEvent.click(screen.getByRole("button", { name: /エンジン: 準備完了/ }));
    fireEvent.click(screen.getByRole("button", { name: "Drama-3 に切替" }));
    expect(startEngine).toHaveBeenCalledWith("p2");
  });

  it("leads to the model catalog and manager from the engine panel", () => {
    setup({ state: "stopped" });
    fireEvent.click(screen.getByRole("button", { name: /エンジン/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /モデルを入手/ }));
    expect(useApp.getState().dialog).toBe("catalog");
    fireEvent.click(screen.getByRole("button", { name: /エンジン/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /モデル管理/ }));
    expect(useApp.getState().view).toBe("models");
  });

  it("leads to the model catalog instead of starting when the chosen profile has no model", () => {
    setup({ state: "stopped" }, "p1", "");
    fireEvent.click(screen.getByRole("button", { name: /エンジン/ }));
    expect(screen.queryByRole("button", { name: /を起動/ })).toBeNull();
    expect(screen.getAllByText(/モデルを入手/)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "モデルを入手…" }));
    expect(startEngine).not.toHaveBeenCalled();
    expect(useApp.getState().dialog).toBe("catalog");
  });

  it("does not offer a switch to a profile without a model", () => {
    setup({ state: "ready", profileId: "p2", model: {}, sampleRate: 48000 }, "p1", "");
    fireEvent.click(screen.getByRole("button", { name: /エンジン: 準備完了/ }));
    expect(screen.queryByRole("button", { name: /に切替/ })).toBeNull();
    expect(screen.getByRole("button", { name: "モデルを入手…" })).toBeTruthy();
  });
});
