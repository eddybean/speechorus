import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Inspector } from "./Inspector";
import { newLine, useProject } from "../../store/project";
import type { Take } from "../../lib/types";

vi.mock("../generate/actions", async (orig) => ({
  ...(await orig<typeof import("../generate/actions")>()),
  rerollTake: vi.fn(),
  copySeed: vi.fn(),
}));
vi.mock("../tags/TagPalette", () => ({ TagPalette: () => null }));

import { copySeed, rerollTake } from "../generate/actions";

const take: Take = { id: "t1", seed: 4212077026712288, optionsSnapshot: {}, file: "t1.wav", duration: 1, sampleRate: 44100, stopReason: "complete", createdAt: 0, starred: false, text: "" };

describe("Inspector seeds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const line = newLine({ id: "l1", text: "ねえ", takes: [take] });
    useProject.setState((s) => ({ project: { ...s.project, lines: [line] }, activeLineId: "l1" }));
  });

  it("copies a take's seed when it is clicked", () => {
    render(<Inspector />);
    fireEvent.click(screen.getByRole("button", { name: "シードをコピー" }));
    expect(copySeed).toHaveBeenCalledWith(4212077026712288);
  });

  it("generates one take with a pasted seed, and refuses one that is not a seed", () => {
    render(<Inspector />);
    const box = screen.getByRole("textbox", { name: "シード値" });
    const go = screen.getByRole("button", { name: /このシードで生成/ }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(box, { target: { value: "abc" } });
    expect(go.disabled).toBe(true);
    fireEvent.change(box, { target: { value: " 🎲4212077026712288 " } });
    fireEvent.click(go);
    expect(rerollTake).toHaveBeenCalledWith("l1", 4212077026712288);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(rerollTake).toHaveBeenCalledTimes(2);
  });
});
