import { describe, expect, it } from "vitest";
import { dragRange, refLengthAdvice } from "./WaveformTrimmer";

describe("reference trimming", () => {
  it("advises on the length", () => {
    expect(refLengthAdvice(2).level).toBe("warn");
    expect(refLengthAdvice(6).level).toBe("ok");
    expect(refLengthAdvice(20).text).toContain("推奨範囲内");
    expect(refLengthAdvice(45).level).toBe("warn");
  });
  it("drags a handle without crossing the other", () => {
    expect(dragRange(2, 10, 5, "start", 30)).toEqual([5, 10]);
    expect(dragRange(2, 10, 12, "start", 30)).toEqual([9.8, 10]);
    expect(dragRange(2, 10, 40, "end", 30)).toEqual([2, 30]);
    expect(dragRange(2, 10, 1, "end", 30)).toEqual([2, 2.2]);
    expect(dragRange(2, 10, -3, "start", 30)).toEqual([0, 10]);
  });
});
