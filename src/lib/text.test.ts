import { describe, expect, it } from "vitest";
import { applyPaste, insertTag, normalizeTag, parseScript, parseSeed, plainText, seedFor, splitForPaste, tokenize, workerVoiceName } from "./text";

describe("tokenize", () => {
  it("finds cues, speakers and emoji", () => {
    const t = tokenize("<|speaker:1|>[驚いて]本当に？🤭😮‍💨ね");
    expect(t.map((x) => [x.kind, x.text])).toEqual([
      ["speaker", "<|speaker:1|>"],
      ["tag", "[驚いて]"],
      ["text", "本当に？"],
      ["emoji", "🤭"],
      ["emoji", "😮‍💨"],
      ["text", "ね"],
    ]);
  });
  it("leaves an unclosed bracket as text", () => {
    expect(tokenize("a[b").map((x) => x.kind)).toEqual(["text"]);
  });
  it("plainText drops everything but speech", () => {
    expect(plainText("[囁き]ねえ、 <|speaker:0|> 🤭そう")).toBe("ねえ、 そう");
  });
});

describe("insertTag", () => {
  it("inserts at the cursor and replaces a selection", () => {
    expect(insertTag("本当に？", 0, 0, "[驚いて]")).toEqual({ text: "[驚いて]本当に？", cursor: 5 });
    expect(insertTag("あいう", 1, 2, "[笑い]")).toEqual({ text: "あ[笑い]う", cursor: 5 });
  });
  it("never splits an existing cue", () => {
    expect(insertTag("[明るく]ね", 2, 2, "[笑い]").text).toBe("[明るく][笑い]ね");
  });
  it("normalizes tags per syntax", () => {
    expect(normalizeTag("囁き", "brackets")).toBe("[囁き]");
    expect(normalizeTag("[囁き]", "brackets")).toBe("[囁き]");
    expect(normalizeTag("🤭", "emoji")).toBe("🤭");
  });
});

describe("paste splitting", () => {
  it("splits at 。 and newlines but not inside cues", () => {
    expect(splitForPaste("「こんにちは。」元気？[説明。中]そう。\n\n次の行")).toEqual(["「こんにちは。」", "元気？[説明。中]そう。", "次の行"]);
  });
  it("applyPaste keeps a single piece in the line", () => {
    expect(applyPaste("ab", 1, 1, "X")).toEqual(["aXb"]);
    expect(applyPaste("前後", 1, 1, "一。二。三")).toEqual(["前一。", "二。", "三後"]);
  });
});

describe("parseScript", () => {
  it("reads VOICEVOX style txt, csv quoting and bare lines", () => {
    const r = parseScript('﻿ずんだ,こんにちは、元気？\r\n\r\n"めたん","言った, ""はい""。"\n[囁き]地の文だけ\nナレーション\tむかしむかし');
    expect(r).toEqual([
      { castName: "ずんだ", text: "こんにちは、元気？" },
      { castName: "めたん", text: '言った, "はい"。' },
      { castName: null, text: "[囁き]地の文だけ" },
      { castName: "ナレーション", text: "むかしむかし" },
    ]);
  });
});

describe("seeds and names", () => {
  it("computes seeds per mode", () => {
    expect([0, 1, 2].map((k) => seedFor("sequential", 10, k))).toEqual([10, 11, 12]);
    expect(seedFor("fixed", 7, 3)).toBe(7);
    expect(seedFor("random", 7, 3)).toBeNull();
  });

  it("reads a pasted seed", () => {
    expect(parseSeed(" 🎲4212077026712288 ")).toBe(4212077026712288);
    expect(parseSeed("1,234")).toBe(1234);
    expect(parseSeed("0")).toBe(0);
    expect(["", "?", "-1", "1.5", "abc", "99999999999999999999"].map(parseSeed)).toEqual([null, null, null, null, null, null]);
  });
  it("matches the Rust worker voice name", () => {
    expect(workerVoiceName("12ab-cd")).toBe("v12abcd");
  });
});
