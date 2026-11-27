// The open project, with Undo/Redo built from immer patches.
import { applyPatches, enablePatches, produce, produceWithPatches, type Draft, type Patch } from "immer";
import { create } from "zustand";
import type { Cast, Line, Project, Scene, Take } from "../lib/types";
import { CAST_COLORS, uid } from "../lib/text";

enablePatches();

interface HistoryEntry {
  patches: Patch[];
  inverse: Patch[];
  key?: string;
  at: number;
  label: string;
}

export interface ProjectState {
  project: Project;
  /** The .vsproj path, or null while untitled. */
  path: string | null;
  takesDir: string;
  dirty: boolean;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  selection: string[];
  activeLineId: string | null;
}

export const MERGE_MS = 1200;
const MAX_HISTORY = 300;

export function newLine(partial: Partial<Line> = {}): Line {
  return {
    id: uid(),
    castId: null,
    text: "",
    optionsOverride: {},
    preSilence: 0,
    postSilence: 0.3,
    takes: [],
    selectedTakeId: null,
    memo: "",
    ...partial,
  };
}

export function newCast(name: string, index: number, partial: Partial<Cast> = {}): Cast {
  return {
    id: uid(),
    name,
    voiceId: null,
    designPrompt: "",
    defaultOptions: {},
    color: CAST_COLORS[index % CAST_COLORS.length],
    ...partial,
  };
}

export function emptyProject(): Project {
  const narrator = newCast("ナレーター", 0);
  return {
    version: 1,
    id: "",
    name: "untitled",
    takesDir: "",
    modelProfileId: null,
    cast: [narrator],
    lines: [newLine({ castId: narrator.id })],
    scenes: [],
    exportSettings: {
      fileTemplate: "{index}_{cast}_{text8}",
      outDir: "",
      defaultPreSilence: 0,
      defaultPostSilence: 0.3,
    },
  };
}

/** Fills members an older or hand-written file lacks. */
export function normalizeProject(p: Partial<Project>): Project {
  const base = emptyProject();
  return {
    ...base,
    ...p,
    cast: (p.cast ?? base.cast).map((c, i) => ({ ...newCast(c.name ?? `キャスト${i + 1}`, i), ...c })),
    lines: (p.lines ?? []).map((l) => ({ ...newLine(), ...l })),
    scenes: (p.scenes ?? []).map(
      (s: Partial<Scene>) =>
        ({ name: "", lineIds: [], takes: [], selectedTakeId: null, mode: "perLine", ...s }) as Scene,
    ),
    exportSettings: { ...base.exportSettings, ...(p.exportSettings ?? {}) },
  };
}

interface Actions {
  /** A recorded change. Changes with the same `key` within MERGE_MS merge into one undo step. */
  edit: (label: string, recipe: (d: Draft<Project>) => void, key?: string) => void;
  /** A change that is not an undo step (takes arriving from the engine). */
  silent: (recipe: (d: Draft<Project>) => void) => void;
  undo: () => void;
  redo: () => void;
  load: (project: Project, path: string | null, takesDir: string) => void;
  markSaved: (path: string, takesDir: string) => void;
  select: (ids: string[], active?: string | null) => void;
  setActive: (id: string | null) => void;

  addLines: (afterId: string | null, lines: Line[]) => void;
  removeLines: (ids: string[]) => void;
  moveLine: (id: string, toIndex: number) => void;
  setLineText: (id: string, text: string) => void;
  updateLine: (id: string, patch: Partial<Line>, label?: string) => void;
  duplicateLines: (ids: string[]) => void;
  addTake: (lineId: string, take: Take) => void;
  addSceneTake: (sceneId: string, take: Take) => void;
  updateTake: (lineId: string, takeId: string, patch: Partial<Take>) => void;
  removeTake: (lineId: string, takeId: string) => void;
}

export type ProjectStore = ProjectState & Actions;

export const useProject = create<ProjectStore>()((set, get) => {
  const record = (label: string, recipe: (d: Draft<Project>) => void, key?: string) => {
    const s = get();
    const [next, patches, inverse] = produceWithPatches(s.project, recipe);
    if (patches.length === 0) return;
    const now = Date.now();
    const last = s.undoStack[s.undoStack.length - 1];
    let undoStack: HistoryEntry[];
    if (key && last && last.key === key && now - last.at < MERGE_MS) {
      undoStack = [
        ...s.undoStack.slice(0, -1),
        { ...last, patches: [...last.patches, ...patches], inverse: [...inverse, ...last.inverse], at: now },
      ];
    } else {
      undoStack = [...s.undoStack, { patches, inverse, key, at: now, label }].slice(-MAX_HISTORY);
    }
    set({ project: next, undoStack, redoStack: [], dirty: true });
  };

  return {
    project: emptyProject(),
    path: null,
    takesDir: "",
    dirty: false,
    undoStack: [],
    redoStack: [],
    selection: [],
    activeLineId: null,

    edit: record,
    silent: (recipe) => {
      const [next, patches] = produceWithPatches(get().project, recipe);
      if (patches.length) set({ project: next, dirty: true });
    },
    undo: () => {
      const s = get();
      const e = s.undoStack[s.undoStack.length - 1];
      if (!e) return;
      set({
        project: keepUnknownTakes(s.project, applyPatches(s.project, e.inverse), e),
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, { ...e, key: undefined }],
        dirty: true,
      });
    },
    redo: () => {
      const s = get();
      const e = s.redoStack[s.redoStack.length - 1];
      if (!e) return;
      set({
        project: keepUnknownTakes(s.project, applyPatches(s.project, e.patches), e),
        redoStack: s.redoStack.slice(0, -1),
        undoStack: [...s.undoStack, e],
        dirty: true,
      });
    },
    load: (project, path, takesDir) =>
      set({
        project: normalizeProject(project),
        path,
        takesDir,
        dirty: false,
        undoStack: [],
        redoStack: [],
        selection: [],
        activeLineId: null,
      }),
    markSaved: (path, takesDir) => set({ path, takesDir, dirty: false }),
    select: (ids, active) => set({ selection: ids, activeLineId: active === undefined ? get().activeLineId : active }),
    setActive: (id) => set({ activeLineId: id }),

    addLines: (afterId, lines) =>
      record("行を追加", (d) => {
        const i = afterId ? d.lines.findIndex((l) => l.id === afterId) : d.lines.length - 1;
        d.lines.splice(i + 1, 0, ...lines);
      }),
    removeLines: (ids) => {
      const set_ = new Set(ids);
      record("行を削除", (d) => {
        d.lines = d.lines.filter((l) => !set_.has(l.id));
        for (const sc of d.scenes) sc.lineIds = sc.lineIds.filter((id) => !set_.has(id));
      });
      set({ selection: get().selection.filter((id) => !set_.has(id)) });
    },
    moveLine: (id, toIndex) =>
      record("行を移動", (d) => {
        const from = d.lines.findIndex((l) => l.id === id);
        if (from < 0) return;
        const [l] = d.lines.splice(from, 1);
        d.lines.splice(Math.max(0, Math.min(toIndex, d.lines.length)), 0, l);
      }),
    setLineText: (id, text) =>
      record(
        "テキスト編集",
        (d) => {
          const l = d.lines.find((x) => x.id === id);
          if (l && l.text !== text) l.text = text;
        },
        `text:${id}`,
      ),
    updateLine: (id, patch, label = "行の設定") =>
      record(label, (d) => {
        const l = d.lines.find((x) => x.id === id);
        if (l) Object.assign(l, patch);
      }),
    duplicateLines: (ids) =>
      record("行を複製", (d) => {
        const lastIdx = Math.max(...ids.map((id) => d.lines.findIndex((l) => l.id === id)));
        const copies = d.lines
          .filter((l) => ids.includes(l.id))
          .map((l) => ({ ...JSON.parse(JSON.stringify(l)), id: uid(), takes: [], selectedTakeId: null }));
        d.lines.splice(lastIdx + 1, 0, ...copies);
      }),
    addTake: (lineId, take) =>
      get().silent((d) => {
        const l = d.lines.find((x) => x.id === lineId);
        // A take arrives once per job; ignore a repeat delivery of the same one.
        if (!l || l.takes.some((t) => t.id === take.id)) return;
        l.takes.push(take);
        if (!l.selectedTakeId) l.selectedTakeId = take.id;
      }),
    addSceneTake: (sceneId, take) =>
      get().silent((d) => {
        const s = d.scenes.find((x) => x.id === sceneId);
        if (!s || s.takes.some((t) => t.id === take.id)) return;
        s.takes.push(take);
        s.selectedTakeId = take.id;
      }),
    updateTake: (lineId, takeId, patch) =>
      record("テイク", (d) => {
        const t = d.lines.find((x) => x.id === lineId)?.takes.find((x) => x.id === takeId);
        if (t) Object.assign(t, patch);
      }),
    removeTake: (lineId, takeId) =>
      record("テイクを削除", (d) => {
        const l = d.lines.find((x) => x.id === lineId);
        if (!l) return;
        l.takes = l.takes.filter((t) => t.id !== takeId);
        if (l.selectedTakeId === takeId) l.selectedTakeId = l.takes[l.takes.length - 1]?.id ?? null;
      }),
  };
});

/** Every take object inside the values of these patches. */
function patchTakes(patches: Patch[], visit: (t: Take) => void, onFile?: (f: string) => void) {
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.file === "string" && typeof o.stopReason === "string") visit(o as unknown as Take);
      else Object.values(o).forEach(walk);
    }
  };
  for (const p of patches) {
    if (onFile && p.path[p.path.length - 1] === "file" && typeof p.value === "string") onFile(p.value);
    else walk(p.value);
  }
}

/**
 * Undo/Redo patches replace whole arrays (a line's takes, the lines), so applying one would also drop takes that
 * arrived after the step was recorded (takes are not history, D-05). Takes the step never saw are put back on
 * their line or scene, after the ones it restores (D-41).
 */
function keepUnknownTakes(before: Project, after: Project, e: HistoryEntry): Project {
  const known = new Set<string>();
  patchTakes([...e.patches, ...e.inverse], (t) => known.add(t.id));
  const lost = (prev: { takes: Take[] } | undefined, next: { takes: Take[] }) =>
    (prev?.takes ?? []).filter((t) => !known.has(t.id) && !next.takes.some((x) => x.id === t.id));
  const lines = new Map(before.lines.map((l) => [l.id, l]));
  const scenes = new Map(before.scenes.map((x) => [x.id, x]));
  const missing =
    after.lines.some((l) => lost(lines.get(l.id), l).length) ||
    after.scenes.some((x) => lost(scenes.get(x.id), x).length);
  if (!missing) return after;
  return produce(after, (d) => {
    for (const o of [
      ...d.lines.map((l) => [l, lines.get(l.id)] as const),
      ...d.scenes.map((x) => [x, scenes.get(x.id)] as const),
    ]) {
      const [next, prev] = o;
      const back = lost(prev, next);
      if (!back.length) continue;
      next.takes.push(...back);
      if (!next.selectedTakeId || !next.takes.some((t) => t.id === next.selectedTakeId))
        next.selectedTakeId = prev!.selectedTakeId;
    }
  });
}

/**
 * The take files the Undo/Redo history can bring back (D-40): every take found in a patch value, either way.
 * Prune and Save keep these too, so undoing a take deletion after saving finds its WAV.
 */
export function historyTakeFiles(s: Pick<ProjectState, "undoStack" | "redoStack">): string[] {
  const out = new Set<string>();
  for (const e of [...s.undoStack, ...s.redoStack])
    patchTakes(
      [...e.patches, ...e.inverse],
      (t) => out.add(t.file),
      (f) => out.add(f),
    );
  return [...out];
}

/** The take a line plays and exports: its selected one, else its newest. */
export function selectedTake(l: Pick<Line, "takes" | "selectedTakeId">): Take | undefined {
  return l.takes.find((t) => t.id === l.selectedTakeId) ?? l.takes[l.takes.length - 1];
}
