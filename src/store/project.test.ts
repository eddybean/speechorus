import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyProject, newLine, normalizeProject, selectedTake, useProject } from "./project";
import type { Take } from "../lib/types";

const take = (id: string): Take => ({ id, seed: 1, optionsSnapshot: {}, file: `${id}.wav`, duration: 1, sampleRate: 44100, stopReason: "complete", createdAt: 0, starred: false, text: "" });

beforeEach(() => {
  useProject.getState().load(emptyProject(), null, "work");
});

describe("undo / redo", () => {
  it("undoes and redoes line edits", () => {
    const s = useProject.getState;
    const first = s().project.lines[0].id;
    s().addLines(first, [newLine({ text: "二行目" })]);
    expect(s().project.lines.map((l) => l.text)).toEqual(["", "二行目"]);
    s().removeLines([first]);
    expect(s().project.lines).toHaveLength(1);
    s().undo();
    expect(s().project.lines).toHaveLength(2);
    s().undo();
    expect(s().project.lines).toHaveLength(1);
    s().redo();
    s().redo();
    expect(s().project.lines.map((l) => l.text)).toEqual(["二行目"]);
    expect(s().redoStack).toHaveLength(0);
  });

  it("merges typing on one line into one step, but not across lines or after a pause", () => {
    vi.useFakeTimers();
    const s = useProject.getState;
    const id = s().project.lines[0].id;
    s().setLineText(id, "こ");
    s().setLineText(id, "こん");
    s().setLineText(id, "こんにちは");
    expect(s().undoStack).toHaveLength(1);
    vi.advanceTimersByTime(5000);
    s().setLineText(id, "こんにちは。");
    expect(s().undoStack).toHaveLength(2);
    s().undo();
    expect(s().project.lines[0].text).toBe("こんにちは");
    s().undo();
    expect(s().project.lines[0].text).toBe("");
    vi.useRealTimers();
  });

  it("keeps takes that arrive from the engine out of the history", () => {
    const s = useProject.getState;
    const id = s().project.lines[0].id;
    s().setLineText(id, "テスト");
    s().addTake(id, take("t1"));
    s().addTake(id, take("t2"));
    expect(s().undoStack).toHaveLength(1);
    expect(s().project.lines[0].selectedTakeId).toBe("t1");
    s().undo();
    expect(s().project.lines[0].text).toBe("");
    expect(s().project.lines[0].takes.map((t) => t.id)).toEqual(["t1", "t2"]);
    s().removeTake(id, "t1");
    expect(selectedTake(s().project.lines[0])?.id).toBe("t2");
    s().undo();
    expect(s().project.lines[0].takes).toHaveLength(2);
  });

  it("moves and duplicates lines", () => {
    const s = useProject.getState;
    const a = s().project.lines[0].id;
    s().setLineText(a, "A");
    s().addLines(a, [newLine({ text: "B" }), newLine({ text: "C" })]);
    s().moveLine(a, 2);
    expect(s().project.lines.map((l) => l.text)).toEqual(["B", "C", "A"]);
    s().duplicateLines([s().project.lines[0].id]);
    expect(s().project.lines.map((l) => l.text)).toEqual(["B", "B", "C", "A"]);
    expect(s().project.lines[1].id).not.toBe(s().project.lines[0].id);
  });
});

describe("normalizeProject", () => {
  it("fills missing members", () => {
    const p = normalizeProject({ name: "x", lines: [{ id: "l", text: "a" } as never] });
    expect(p.lines[0].takes).toEqual([]);
    expect(p.lines[0].postSilence).toBe(0.3);
    expect(p.exportSettings.fileTemplate).toBe("{index}_{cast}_{text8}");
  });
});
