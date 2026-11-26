import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyProject, historyTakeFiles, newLine, normalizeProject, selectedTake, useProject } from "./project";
import type { Take } from "../lib/types";

const take = (id: string): Take => ({
  id,
  seed: 1,
  optionsSnapshot: {},
  file: `${id}.wav`,
  duration: 1,
  sampleRate: 44100,
  stopReason: "complete",
  createdAt: 0,
  starred: false,
  text: "",
});

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

  it("adds a take delivered twice only once", () => {
    const s = useProject.getState;
    const id = s().project.lines[0].id;
    s().addTake(id, take("t1"));
    s().addTake(id, take("t1"));
    expect(s().project.lines[0].takes.map((t) => t.id)).toEqual(["t1"]);
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

describe("historyTakeFiles", () => {
  it("lists takes that undo or redo can bring back, not ones only the project has", () => {
    const s = useProject.getState;
    const [l1] = s().project.lines;
    s().addLines(l1.id, [newLine({ text: "二行目" })]);
    const l2 = s().project.lines[1].id;
    s().addTake(l1.id, take("a"));
    s().addTake(l1.id, take("b"));
    s().addTake(l2, take("c"));
    s().addTake(l2, take("live"));
    expect(historyTakeFiles(s())).toEqual([]);
    s().removeTake(l1.id, "a");
    expect(historyTakeFiles(s())).toContain("a.wav");
    s().removeLines([l2]);
    expect(historyTakeFiles(s())).toEqual(expect.arrayContaining(["a.wav", "c.wav", "live.wav"]));
    s().undo();
    s().undo();
    // Both deletions are now redo steps, so their takes stay listed.
    expect(historyTakeFiles(s())).toEqual(expect.arrayContaining(["a.wav", "c.wav"]));
    s().load(emptyProject(), null, "work");
    expect(historyTakeFiles(s())).toEqual([]);
  });
});

describe("undo keeps takes that arrived later (D-41)", () => {
  it("keeps a take generated after a take deletion through undo and redo", () => {
    const s = useProject.getState;
    const l = s().project.lines[0].id;
    s().addTake(l, take("a"));
    s().addTake(l, take("b"));
    s().removeTake(l, "a");
    s().addTake(l, take("new"));
    s().undo();
    expect(s().project.lines[0].takes.map((t) => t.id)).toEqual(["a", "b", "new"]);
    s().redo();
    expect(s().project.lines[0].takes.map((t) => t.id)).toEqual(["b", "new"]);
  });

  it("keeps takes of other lines through undoing a line deletion", () => {
    const s = useProject.getState;
    const [l1] = s().project.lines;
    s().addLines(l1.id, [newLine({ text: "二行目" })]);
    const l2 = s().project.lines[1].id;
    s().removeLines([l2]);
    s().addTake(l1.id, take("late"));
    s().undo();
    expect(s().project.lines).toHaveLength(2);
    expect(s().project.lines[0].takes.map((t) => t.id)).toEqual(["late"]);
    expect(s().project.lines[0].selectedTakeId).toBe("late");
  });

  it("still removes the take a redo deletes", () => {
    const s = useProject.getState;
    const l = s().project.lines[0].id;
    s().addTake(l, take("a"));
    s().removeTake(l, "a");
    s().undo();
    expect(s().project.lines[0].takes.map((t) => t.id)).toEqual(["a"]);
    s().redo();
    expect(s().project.lines[0].takes).toEqual([]);
  });
});
