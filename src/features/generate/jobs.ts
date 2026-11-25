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

function stem(line: Line, k: number) {
  return `${line.id.slice(0, 8)}-${Date.now().toString(36)}-${k}`;
}

/** `takesPerLine` jobs for each line, seeds per the batch's mode. */
export function jobsForLines(ctx: BuildContext, lines: Line[], batch: BatchSettings): JobSpec[] {
  const jobs: JobSpec[] = [];
  for (const line of lines) {
    if (!line.text.trim()) continue;
    const cast = ctx.project.cast.find((c) => c.id === line.castId);
    const voice = castVoice(ctx, cast);
    for (let k = 0; k < Math.max(1, batch.takesPerLine); k++) {
      jobs.push({
        jobId: uid(),
        lineId: line.id,
        sceneId: null,
        request: {
          text: line.text,
          voice: voice ? workerVoiceName(voice.id) : null,
          voiceFamily: voice ? voice.family : null,
          designPrompt: cast?.designPrompt?.trim() ? cast.designPrompt : null,
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
  const jobs = jobsForLines(ctx, [line], { takesPerLine: 1, seedMode: seed === null ? "random" : "fixed", baseSeed: seed ?? 0 });
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

/** The single-request text of a scene: `<|speaker:N|> text` per line; a cast without a voice gets its design cue on its first turn. */
export function sceneText(project: Project, lineIds: string[], hasVoice: (castId: string) => boolean): string {
  const speakers = sceneSpeakers(project, lineIds);
  const cued = new Set<string>();
  const parts: string[] = [];
  for (const id of lineIds) {
    const l = project.lines.find((x) => x.id === id);
    if (!l || !l.text.trim()) continue;
    const c = l.castId ?? "";
    const n = speakers.indexOf(c);
    if (n < 0) continue;
    const cast = project.cast.find((x) => x.id === c);
    let cue = "";
    if (cast?.designPrompt.trim() && !hasVoice(c) && !cued.has(c)) {
      cue = `[${cast.designPrompt.trim().replace(/^\[|\]$/g, "")}]`;
      cued.add(c);
    }
    parts.push(`<|speaker:${n}|> ${cue}${l.text.trim()}`);
  }
  return parts.join(" ");
}
