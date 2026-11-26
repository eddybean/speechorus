import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Rail } from "./Rail";
import { useApp } from "../store/app";
import type { AppSettings, EngineState, ModelProfile } from "../lib/types";

const profile = (id: string, name: string, model = "/m.gguf"): ModelProfile => ({
  id, name, adapter: "irodori", model, speechExe: "speech", device: "auto", threads: null, env: {}, extraArgs: [],
});
const settings = (active: string): AppSettings => ({
  version: 1, profiles: [profile("p1", "Irodori Small"), profile("p2", "Drama-3")], activeProfileId: active,
  speechExe: "speech", asrModel: "", asrDevice: "auto", showNsfwTags: false, theme: "dark", recentTags: [], recentProjects: [],
});

const startEngine = vi.fn(async () => {});
const stopEngine = vi.fn(async () => {});
const saveSettings = vi.fn(async () => {});

function setup(engine: EngineState, active = "p1") {
  useApp.setState({ engine, settings: settings(active), dialog: null, castOpen: true, startEngine, stopEngine, saveSettings });
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

  it("opens the voice library, model manager and settings", () => {
    setup({ state: "stopped" });
    fireEvent.click(screen.getByRole("button", { name: "ボイス" }));
    expect(useApp.getState().dialog).toBe("voices");
    fireEvent.click(screen.getByRole("button", { name: "モデル" }));
    expect(useApp.getState().dialog).toBe("models");
    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    expect(useApp.getState().dialog).toBe("settings");
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
  });
});
