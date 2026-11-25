// Commands the toolbar, rows and shortcuts share: generate, play, scenes.
import { joinPath, ipc } from "../../lib/ipc";
import { usePlayer, type PlayItem } from "../../lib/player";
import { uid, workerVoiceName } from "../../lib/text";
import type { Line } from "../../lib/types";
import { useApp } from "../../store/app";
import { selectedTake, useProject } from "../../store/project";
import { jobsForLines, sceneSpeakers, sceneText, type BuildContext } from "./jobs";

function context(): BuildContext | null {
  const app = useApp.getState();
  const adapter = app.activeAdapter();
  const { project, takesDir } = useProject.getState();
  if (!adapter) {
    app.notify("error", "モデルプロファイルがありません");
    return null;
  }
  if (app.engine.state !== "ready") {
    app.notify("warn", "エンジンが起動していません（上部の「起動」でモデルを読み込んでください）");
    return null;
  }
  return { project, voices: app.voices, adapter, takesDir };
}

export async function generateLines(lines: Line[]) {
  const ctx = context();
  if (!ctx) return;
  const jobs = jobsForLines(ctx, lines, useApp.getState().batch);
  if (!jobs.length) {
    useApp.getState().notify("info", "生成する行がありません（テキストが空です）");
    return;
  }
  await useApp.getState().enqueue(jobs);
}

export function generateIds(ids: string[]) {
  const lines = useProject.getState().project.lines.filter((l) => ids.includes(l.id));
  return generateLines(lines);
}

export function generateAll() {
  return generateLines(useProject.getState().project.lines);
}

export function generateMissing() {
  return generateLines(useProject.getState().project.lines.filter((l) => l.takes.length === 0));
}

export function generateSelected() {
  const { selection, activeLineId } = useProject.getState();
  const ids = selection.length ? selection : activeLineId ? [activeLineId] : [];
  return generateIds(ids);
}

export async function rerollTake(lineId: string, seed: number | null) {
  const ctx = context();
  if (!ctx) return;
  const line = ctx.project.lines.find((l) => l.id === lineId);
  if (!line) return;
  await useApp.getState().enqueue(jobsForLines(ctx, [line], { takesPerLine: 1, seedMode: seed === null ? "random" : "fixed", baseSeed: seed ?? 0 }));
}

function playItems(lines: Line[]): PlayItem[] {
  const { takesDir } = useProject.getState();
  return lines.flatMap((l) => {
    const t = selectedTake(l);
    return t ? [{ path: joinPath(takesDir, t.file), pre: l.preSilence, post: l.postSilence, key: l.id }] : [];
  });
}

export function playLine(lineId: string, takeId?: string) {
  const { project, takesDir } = useProject.getState();
  const l = project.lines.find((x) => x.id === lineId);
  if (!l) return;
  const t = takeId ? l.takes.find((x) => x.id === takeId) : selectedTake(l);
  if (!t) {
    useApp.getState().notify("info", "この行にはまだテイクがありません");
    return;
  }
  usePlayer.getState().play([{ path: joinPath(takesDir, t.file), pre: 0, post: 0, key: takeId ?? l.id }]);
}

/** Plays the selected takes from `lineId` to the end, with each line's silences. */
export function playFrom(lineId: string | null) {
  const { project } = useProject.getState();
  const i = Math.max(0, lineId ? project.lines.findIndex((l) => l.id === lineId) : 0);
  const items = playItems(project.lines.slice(i));
  if (!items.length) useApp.getState().notify("info", "再生できるテイクがありません");
  else usePlayer.getState().play(items);
}

export function togglePlay() {
  const p = usePlayer.getState();
  if (p.playingKey) p.stop();
  else {
    const { activeLineId, selection } = useProject.getState();
    const id = activeLineId ?? selection[0];
    if (id) playLine(id);
  }
}

// ---- scenes ----

export function createScene(lineIds: string[]) {
  const { project, edit } = useProject.getState();
  const ordered = project.lines.filter((l) => lineIds.includes(l.id)).map((l) => l.id);
  if (ordered.length < 2) {
    useApp.getState().notify("info", "シーンには2行以上を選択してください");
    return;
  }
  const caps = useApp.getState().activeAdapter()?.capabilities;
  const mode = caps?.multiSpeaker && caps.multiSpeakerReliable ? "single" : "perLine";
  edit("シーンを作成", (d) => {
    d.scenes.push({ id: uid(), name: `シーン${d.scenes.length + 1}`, lineIds: ordered, mode, takes: [], selectedTakeId: null });
  });
}

/** Single mode: one `<|speaker:N|>` request with a cast voice put together from the casts' voices.
 *  Per-line mode: the lines without a take are generated, each with its own voice. */
export async function generateScene(sceneId: string) {
  const ctx = context();
  if (!ctx) return;
  const scene = ctx.project.scenes.find((s) => s.id === sceneId);
  if (!scene) return;
  const app = useApp.getState();
  if (scene.mode === "perLine") {
    const lines = ctx.project.lines.filter((l) => scene.lineIds.includes(l.id) && l.takes.length === 0);
    if (!lines.length) app.notify("info", "シーンの全行にテイクがあります（再生・書き出しできます）");
    await generateLines(lines);
    return;
  }
  if (!ctx.adapter.capabilities.multiSpeaker) {
    app.notify("error", `${ctx.adapter.displayName} は1リクエストでの複数話者に対応していません`);
    return;
  }
  const speakers = sceneSpeakers(ctx.project, scene.lineIds);
  const voiceIds = speakers.map((castId) => {
    const c = ctx.project.cast.find((x) => x.id === castId);
    const v = c?.voiceId ? ctx.voices.find((x) => x.id === c.voiceId && x.family === ctx.adapter.id && x.speakers === 1) : undefined;
    return v?.id ?? null;
  });
  const profile = app.activeProfile();
  if (!profile) return;
  let voice = null;
  try {
    voice = await ipc.voiceCombine(profile.id, voiceIds);
  } catch (e) {
    app.notify("error", `キャストボイスを作れません: ${e}`);
    return;
  }
  await app.refreshVoices();
  const hasVoice = (castId: string) => voiceIds[speakers.indexOf(castId)] !== null;
  const text = sceneText(ctx.project, scene.lineIds, hasVoice);
  const batch = app.batch;
  const jobs = Array.from({ length: Math.max(1, batch.takesPerLine) }, (_, k) => ({
    jobId: uid(),
    lineId: null,
    sceneId: scene.id,
    request: {
      text,
      voice: voice ? workerVoiceName(voice.id) : null,
      voiceFamily: voice ? voice.family : null,
      designPrompt: null,
      options: {},
      seed: batch.seedMode === "random" ? null : batch.seedMode === "fixed" ? batch.baseSeed : batch.baseSeed + k,
    },
    voicePath: voice ? voice.file : null,
    outDir: ctx.takesDir,
    fileStem: `scene-${scene.id.slice(0, 8)}-${Date.now().toString(36)}-${k}`,
  }));
  if (!ctx.adapter.capabilities.multiSpeakerReliable) app.notify("warn", "このモデルでは2人目以降が発話されないことがあります（docs/engine-protocol.md）");
  await app.enqueue(jobs);
}

export function playScene(sceneId: string) {
  const { project, takesDir } = useProject.getState();
  const s = project.scenes.find((x) => x.id === sceneId);
  if (!s) return;
  if (s.mode === "single") {
    const t = s.takes.find((x) => x.id === s.selectedTakeId) ?? s.takes[s.takes.length - 1];
    if (t) usePlayer.getState().play([{ path: joinPath(takesDir, t.file), pre: 0, post: 0, key: s.id }]);
    else useApp.getState().notify("info", "シーンのテイクがまだありません");
    return;
  }
  const items = playItems(project.lines.filter((l) => s.lineIds.includes(l.id)));
  if (items.length) usePlayer.getState().play(items);
}
