import { describe, expect, it } from "vitest";
import { linesFromClipboard, linesToText } from "./clipboard";
import { newCast, newLine } from "../../store/project";
import { queueEta } from "../../store/app";

describe("line clipboard", () => {
  const a = newCast("ミカ", 0);
  const lines = [
    newLine({ castId: a.id, text: "[囁き]ねえ", optionsOverride: { top_k: 5 }, preSilence: 0.4, takes: [{ id: "t" } as never], selectedTakeId: "t" }),
    newLine({ castId: null, text: "地の文" }),
  ];

  it("writes キャラ,テキスト text", () => {
    expect(linesToText(lines, [a])).toBe("ミカ,[囁き]ねえ\n地の文");
  });

  it("restores its own copy with options but new ids and no takes", () => {
    const text = linesToText(lines, [a]);
    const r = linesFromClipboard(text, { text, lines }, [a]);
    expect(r.lines.map((l) => [l.text, l.castId, l.preSilence, l.optionsOverride])).toEqual([
      ["[囁き]ねえ", a.id, 0.4, { top_k: 5 }],
      ["地の文", null, 0, {}],
    ]);
    expect(r.lines[0].id).not.toBe(lines[0].id);
    expect(r.lines[0].takes).toEqual([]);
    expect(r.newCast).toEqual([]);
  });

  it("parses foreign text and creates missing casts", () => {
    const r = linesFromClipboard("ミカ,こんにちは\nハル,やあ", null, [a]);
    expect(r.newCast.map((c) => c.name)).toEqual(["ハル"]);
    expect(r.lines[0].castId).toBe(a.id);
    expect(r.lines[1].castId).toBe(r.newCast[0].id);
  });
});

describe("queue ETA", () => {
  it("is mean job time × jobs left, minus the running job's elapsed time", () => {
    expect(queueEta(0, [1000], null)).toBeNull();
    expect(queueEta(3, [], null)).toBeNull();
    expect(queueEta(3, [1000, 3000], null)).toBe(6);
    expect(queueEta(3, [2000], 10_000, 10_500)).toBe(5.5);
    expect(queueEta(1, [2000], 0, 99_999)).toBe(0);
  });
});
