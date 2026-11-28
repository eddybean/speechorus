import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipc } from "../lib/ipc";
import { memoryBlockedText, memoryConfirmText, useApp } from "./app";
import type { MemoryCheck, StartResult } from "../lib/types";

vi.mock("../lib/ipc", () => ({
  inTauri: false,
  joinPath: (...p: string[]) => p.join("/"),
  onAppEvent: vi.fn(),
  ipc: { engineStart: vi.fn(), saveSettings: vi.fn(async () => {}) },
}));

const GIB = 2 ** 30;
const check = (over: Partial<MemoryCheck> = {}): MemoryCheck => ({
  level: "standard",
  device: "Vulkan0",
  description: "NVIDIA GeForce RTX 4090",
  gpu: true,
  free: 10 * GIB,
  reclaim: 0,
  total: 24 * GIB,
  fileBytes: 20.8 * GIB,
  need: 23.4 * GIB,
  verdict: "confirm",
  ...over,
});
const start = vi.mocked(ipc.engineStart);

describe("startEngine and the memory check (D-58)", () => {
  beforeEach(() => {
    start.mockReset();
    useApp.setState({ settings: null, notices: [] });
  });

  it("starts at once when it fits", async () => {
    start.mockResolvedValueOnce({ status: "started" });
    const ask = vi.spyOn(window, "confirm");
    await useApp.getState().startEngine("p1");
    expect(start).toHaveBeenCalledTimes(1);
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks, and starts again with confirmed only on yes", async () => {
    const r: StartResult = { status: "confirm", check: check() };
    start.mockResolvedValue(r);
    const ask = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    await useApp.getState().startEngine("p1");
    expect(ask).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);

    ask.mockReturnValueOnce(true);
    start.mockResolvedValueOnce(r).mockResolvedValueOnce({ status: "started" });
    await useApp.getState().startEngine("p1");
    expect(start).toHaveBeenLastCalledWith("p1", true);
  });

  it("does not offer to start when blocked", async () => {
    start.mockResolvedValueOnce({ status: "blocked", check: check({ level: "strict", verdict: "block" }) });
    const ask = vi.spyOn(window, "confirm");
    await useApp.getState().startEngine("p1");
    expect(ask).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledTimes(1);
    expect(useApp.getState().notices[0]?.text).toContain("起動を中止しました");
  });

  it("names the memory and the figures", () => {
    const t = memoryConfirmText(check());
    expect(t).toContain("Vulkan0（NVIDIA GeForce RTX 4090）の VRAM");
    expect(t).toContain("必要 23.4 GiB（目安） / 空き 10.0 GiB");
    expect(memoryConfirmText(check({ gpu: false, level: "low", need: 20.8 * GIB }))).toContain(
      "メインメモリの空きが足りない可能性があります。\n必要 20.8 GiB（モデルファイル）",
    );
    expect(memoryBlockedText(check({ need: 24.9 * GIB }))).toContain("必要量 24.9 GiB（余裕 1.5 GiB を含む）");
  });
});
