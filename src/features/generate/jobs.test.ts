import { describe, expect, it } from "vitest";
import { castVoicing, jobsForLines, mergedOptions, sceneSpeakers, sceneText } from "./jobs";
import { emptyProject, newCast, newLine } from "../../store/project";
import type { AdapterDescriptor, Voice } from "../../lib/types";

const drama: AdapterDescriptor = {
  id: "drama3",
  displayName: "Drama-3",
  capabilities: {} as never,
  options: [
    { name: "temperature", label: "", kind: "float", default: 1, min: 0, max: 2, step: 0.1, help: "" },
    { name: "top_k", label: "", kind: "int", default: 30, min: 1, max: 4097, step: 1, help: "" },
  ],
};

const voice: Voice = { id: "aaaa-bbbb", name: "me", family: "drama3", file: "C:/v/me.voice.gguf", sources: [], speakers: 1, combinedFrom: [], createdAt: 0, note: "", prompt: "" };

describe("jobsForLines", () => {
  it("makes N takes per line with sequential seeds and the cast's voice", () => {
    const p = emptyProject();
    const c = newCast("ミカ", 1, { voiceId: voice.id, defaultOptions: { temperature: 0.8, speed: 2 } });
    p.cast.push(c);
    const a = newLine({ castId: c.id, text: "[囁き]ねえ", optionsOverride: { top_k: 10 } });
    const empty = newLine({ text: "  " });
    const jobs = jobsForLines({ project: p, voices: [voice], adapter: drama, takesDir: "D:/t" }, [a, empty], { takesPerLine: 3, seedMode: "sequential", baseSeed: 100 });
    expect(jobs).toHaveLength(3);
    expect(jobs.map((j) => j.request.seed)).toEqual([100, 101, 102]);
    expect(jobs[0].request.voice).toBe("vaaaabbbb");
    expect(jobs[0].voicePath).toBe(voice.file);
    expect(jobs[0].request.options).toEqual({ temperature: 0.8, top_k: 10 });
    expect(jobs[0].outDir).toBe("D:/t");
    expect(new Set(jobs.map((j) => j.fileStem)).size).toBe(3);
  });

  it("ignores a voice of another model family and uses the design prompt", () => {
    const p = emptyProject();
    const c = newCast("A", 0, { voiceId: "x", designPrompt: "落ち着いた女性" });
    p.cast.push(c);
    const iro: Voice = { ...voice, id: "x", family: "irodori" };
    const [j] = jobsForLines({ project: p, voices: [iro], adapter: drama, takesDir: "" }, [newLine({ castId: c.id, text: "a" })], { takesPerLine: 1, seedMode: "random", baseSeed: 0 });
    expect(j.request.voice).toBeNull();
    expect(j.request.designPrompt).toBe("落ち着いた女性");
    expect(j.request.seed).toBeNull();
  });

  it("mergedOptions keeps known options only", () => {
    expect(mergedOptions(drama, undefined, newLine({ optionsOverride: { top_k: 5, steps: 3, temperature: null } }))).toEqual({ top_k: 5 });
  });
});

describe("scenes", () => {
  it("numbers speakers by first appearance and cues voiceless casts once", () => {
    const p = emptyProject();
    const a = newCast("A", 0, { designPrompt: "明るい少女" });
    const b = newCast("B", 1, { voiceId: "v" });
    p.cast = [a, b];
    const l = [newLine({ castId: b.id, text: "晴れたね。" }), newLine({ castId: a.id, text: "うん！" }), newLine({ castId: a.id, text: "行こう。" })];
    p.lines = l;
    const ids = l.map((x) => x.id);
    expect(sceneSpeakers(p, ids)).toEqual([b.id, a.id]);
    expect(sceneText(p, ids, (c) => (c === b.id ? null : "明るい少女"))).toBe("<|speaker:0|> 晴れたね。 <|speaker:1|> [明るい少女]うん！ <|speaker:1|> 行こう。");
  });
});

describe("prompt voices", () => {
  const promptVoice: Voice = { ...voice, id: "pv", file: "", prompt: "落ち着いた25歳の女性。" };

  it("sends voice none with the voice's description, unless the cast has its own", () => {
    const p = emptyProject();
    const c = newCast("A", 0, { voiceId: "pv" });
    p.cast.push(c);
    const ctx = { project: p, voices: [promptVoice], adapter: drama, takesDir: "" };
    const [j] = jobsForLines(ctx, [newLine({ castId: c.id, text: "ねえ" })], { takesPerLine: 1, seedMode: "random", baseSeed: 0 });
    expect(j.request.voice).toBeNull();
    expect(j.voicePath).toBeNull();
    expect(j.request.designPrompt).toBe("落ち着いた25歳の女性。");
    expect(castVoicing(ctx, { ...c, designPrompt: "低い男性" }).prompt).toBe("低い男性");
  });

  it("keeps a voice file and the cast's prompt for a recorded voice", () => {
    const r = castVoicing({ voices: [voice], adapter: drama }, newCast("B", 0, { voiceId: voice.id }));
    expect(r.file?.id).toBe(voice.id);
    expect(r.prompt).toBeNull();
  });
});
