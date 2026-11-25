import { describe, expect, it } from "vitest";
import { designJobs, designTranscript, saidAll } from "./VoiceDesigner";

describe("voice design", () => {
  it("makes candidate jobs with consecutive seeds and the description as the design prompt", () => {
    const jobs = designJobs("落ち着いた女性", "[囁き]こんにちは。", 3, 100, "D:/w/design");
    expect(jobs.map((j) => j.request.seed)).toEqual([100, 101, 102]);
    expect(jobs.every((j) => j.request.voice === null && j.request.designPrompt === "落ち着いた女性" && j.lineId === null && j.sceneId === null)).toBe(true);
    expect(jobs[0].outDir).toBe("D:/w/design");
    expect(new Set(jobs.map((j) => j.fileStem)).size).toBe(3);
  });
  it("uses the sample without cues as the transcript", () => {
    expect(designTranscript("[囁き]ねえ、[笑い]こっちに来て。")).toBe("ねえ、こっちに来て。");
  });
});

describe("candidate check", () => {
  const sample = "[明るく]こんにちは。今日はよろしくお願いします。少し緊張していますが、最後まで精一杯がんばりますね。";
  it("accepts the whole sample regardless of punctuation", () => {
    expect(saidAll("こんにちは、今日はよろしくお願いします。少し緊張していますが最後まで精一杯がんばりますね", sample)).toBe(true);
    // ASR writes kana as kanji
    expect(saidAll("こんにちは。今日はよろしくお願いします。少し緊張していますが、最後まで精一杯頑張りますね。", sample)).toBe(true);
  });
  it("flags a take that stopped early", () => {
    expect(saidAll("こんにちは。今日はよろしくお願いします。少し緊張していますが。", sample)).toBe(false);
    expect(saidAll("", sample)).toBe(false);
  });
});
