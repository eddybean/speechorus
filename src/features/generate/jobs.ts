// Turns script lines into GenerationQueue jobs.
import type { AdapterDescriptor, Cast, JobSpec, Line, Options, Project, Voice } from "../../lib/types";
import { seedFor, uid, workerVoiceName, type SeedMode } from "../../lib/text";

export interface BatchSettings {
  takesPerLine: number;
  seedMode: SeedMode;
  baseSeed: number;
}

export interface BuildContext {
  project: Project;
  voices: Voice[];
  adapter: AdapterDescriptor;
  takesDir: string;
}

/** Cast defaults, then the line's overrides; only options the model takes are kept. */
export function mergedOptions(adapter: AdapterDescriptor, cast: Cast | undefined, line: Line): Options {
  const known = new Set(adapter.options.map((o) => o.name));
  const out: Options = {};
  for (const src of [cast?.defaultOptions ?? {}, line.optionsOverride]) {
    for (const [k, v] of Object.entries(src)) if (known.has(k) && v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

export function castVoice(ctx: Pick<BuildContext, "voices" | "adapter">, cast: Cast | undefined): Voice | undefined {
  if (!cast?.voiceId) return undefined;
  const v = ctx.voices.find((x) => x.id === cast.voiceId);
  return v && v.family === ctx.adapter.id ? v : undefined;
}

/** True for a voice that is a description alone (no voice file). */
export function isPromptVoice(v: Voice | undefined): boolean {
  return !!v && !v.file && !!v.prompt?.trim();
}

/**
 * What a cast sends: a voice file, or `voice none` with a description — the cast's own design prompt,
 * else the prompt voice's (Drama-3 writes it as a leading cue, Irodori sends it as `instructions`).
 */
export function castVoicing(
  ctx: Pick<BuildContext, "voices" | "adapter">,
  cast: Cast | undefined,
): { file: Voice | undefined; prompt: string | null } {
  const v = castVoice(ctx, cast);
  const own = cast?.designPrompt?.trim() ?? "";
  if (isPromptVoice(v)) return { file: undefined, prompt: own || v!.prompt.trim() };
  return { file: v, prompt: own || null };
}

function stem(line: Line, k: number) {
  return `${line.id.slice(0, 8)}-${Date.now().toString(36)}-${k}`;
}

/** `takesPerLine` jobs for each line, seeds per the batch's mode. */
export function jobsForLines(ctx: BuildContext, lines: Line[], batch: BatchSettings): JobSpec[] {
  const jobs: JobSpec[] = [];
  for (const line of lines) {
    if (!line.text.trim()) continue;
    const cast = ctx.project.cast.find((c) => c.id === line.castId);
    const { file: voice, prompt } = castVoicing(ctx, cast);
    for (let k = 0; k < Math.max(1, batch.takesPerLine); k++) {
      jobs.push({
        jobId: uid(),
        lineId: line.id,
        sceneId: null,
        request: {
          text: line.text,
          voice: voice ? workerVoiceName(voice.id) : null,
          voiceFamily: voice ? voice.family : null,
          designPrompt: prompt,
          options: mergedOptions(ctx.adapter, cast, line),
          seed: seedFor(batch.seedMode, batch.baseSeed, k),
        },
        voicePath: voice ? voice.file : null,
        outDir: ctx.takesDir,
        fileStem: stem(line, k),
      });
    }
  }
  return jobs;
}

/** A re-roll of a take with its own seed and options. */
export function rerollJob(ctx: BuildContext, line: Line, seed: number | null): JobSpec[] {
  const jobs = jobsForLines(ctx, [line], {
    takesPerLine: 1,
    seedMode: seed === null ? "random" : "fixed",
    baseSeed: seed ?? 0,
  });
  return jobs;
}

/** Speaker numbers for a scene: each cast in order of first appearance. */
export function sceneSpeakers(project: Project, lineIds: string[]): string[] {
  const order: string[] = [];
  for (const id of lineIds) {
    const l = project.lines.find((x) => x.id === id);
    const c = l?.castId ?? "";
    if (!order.includes(c)) order.push(c);
  }
  return order.slice(0, 16);
}

/** The single-request text of a scene: `<|speaker:N|> text` per line; `cueFor` gives the description a speaker
 *  without a voice file gets as a cue on its first turn (null when it has one). */
export function sceneText(project: Project, lineIds: string[], cueFor: (castId: string) => string | null): string {
  const speakers = sceneSpeakers(project, lineIds);
  const cued = new Set<string>();
  const parts: string[] = [];
  for (const id of lineIds) {
    const l = project.lines.find((x) => x.id === id);
    if (!l || !l.text.trim()) continue;
    const c = l.castId ?? "";
    const n = speakers.indexOf(c);
    if (n < 0) continue;
    let cue = "";
    const desc = cueFor(c)?.trim();
    if (desc && !cued.has(c)) {
      cue = `[${desc.replace(/^\[|\]$/g, "")}]`;
      cued.add(c);
    }
    parts.push(`<|speaker:${n}|> ${cue}${l.text.trim()}`);
  }
  return parts.join(" ");
}
