// App-wide state: settings, model adapters, engine, queue, voice library, notices.
import { create } from "zustand";
import { inTauri, ipc, onAppEvent } from "../lib/ipc";
import type { DownloadProgress, AdapterDescriptor, AppSettings, EngineState, JobSpec, ModelProfile, Voice } from "../lib/types";
import type { BatchSettings } from "../features/generate/jobs";
import { useProject } from "./project";

export interface JobInfo {
  lineId: string | null;
  sceneId: string | null;
  status: "queued" | "running";
  seconds: number;
}

export interface Notice {
  id: number;
  kind: "info" | "warn" | "error";
  text: string;
}

interface AppStore {
  ready: boolean;
  settings: AppSettings | null;
  adapters: AdapterDescriptor[];
  engine: EngineState;
  logs: string[];
  jobs: Record<string, JobInfo>;
  jobOrder: string[];
  /** When the running job started, and how long finished jobs took (ms), for the ETA. */
  runningSince: number | null;
  jobDurations: number[];
  installing: boolean;
  downloads: Record<string, DownloadProgress>;
  installSpeech: () => Promise<void>;
  voices: Voice[];
  batch: BatchSettings;
  notices: Notice[];
  dialog: null | "models" | "voices" | "export" | "settings" | "catalog";

  init: () => Promise<void>;
  saveSettings: (s: AppSettings) => Promise<void>;
  activeProfile: () => ModelProfile | undefined;
  activeAdapter: () => AdapterDescriptor | undefined;
  refreshVoices: () => Promise<void>;
  startEngine: (profileId: string) => Promise<void>;
  stopEngine: () => Promise<void>;
  enqueue: (jobs: JobSpec[]) => Promise<void>;
  cancelAll: () => Promise<void>;
  cancelLine: (lineId: string) => Promise<void>;
  setBatch: (b: Partial<BatchSettings>) => void;
  notify: (kind: Notice["kind"], text: string) => void;
  dismiss: (id: number) => void;
  openDialog: (d: AppStore["dialog"]) => void;
}

let noticeSeq = 1;
let unlisten: (() => void) | null = null;

export const useApp = create<AppStore>()((set, get) => ({
  ready: false,
  settings: null,
  adapters: [],
  engine: { state: "stopped" },
  logs: [],
  jobs: {},
  jobOrder: [],
  runningSince: null,
  jobDurations: [],
  installing: false,
  downloads: {},
  installSpeech: async () => {
    if (!confirm("speech.cpp の最新公式リリース（Windows Vulkan 版・約30MB）を GitHub からダウンロードし、SHA-256 を確認して展開します。よろしいですか？")) return;
    set({ installing: true });
    try {
      const s = await ipc.installSpeech();
      set({ settings: s });
      get().notify("info", `speech.cpp をインストールしました: ${s.speechExe}`);
    } catch (e) {
      get().notify("error", `インストールに失敗: ${e}`);
    } finally {
      set({ installing: false });
    }
  },
  voices: [],
  batch: { takesPerLine: 1, seedMode: "random", baseSeed: 1 },
  notices: [],
  dialog: null,

  init: async () => {
    if (!inTauri) {
      set({ ready: true });
      return;
    }
    const [settings, adapters, engine, voices, workDir] = await Promise.all([
      ipc.getSettings(),
      ipc.listAdapters(),
      ipc.engineState(),
      ipc.voicesList(),
      ipc.projectNew(),
    ]);
    const p = useProject.getState();
    p.load(p.project, null, workDir);
    document.documentElement.dataset.theme = settings.theme;
    set({ settings, adapters, engine, voices, ready: true });
    unlisten?.();
    unlisten = await onAppEvent((ev) => {
      if (ev.kind === "engine") {
        set({ engine: ev.data });
        if (ev.data.state === "failed") get().notify("error", `エンジン: ${ev.data.message}`);
      } else if (ev.kind === "download") {
        const d = ev.data;
        // Terminal events carry no byte counts: keep the last ones so the bar stays meaningful.
        set((s) => {
          const prev = s.downloads[d.id];
          const keep = d.total === 0 && prev ? { done: prev.done, total: prev.total, file: prev.file } : {};
          return { downloads: { ...s.downloads, [d.id]: { ...d, ...keep } } };
        });
        if (d.phase === "done") {
          get().notify("info", `ダウンロード完了: ${d.message}`);
          void ipc.getSettings().then((s) => set({ settings: s }));
        } else if (d.phase === "failed") {
          get().notify("error", `ダウンロード失敗: ${d.message}`);
        }
      } else if (ev.kind === "engineLog") {
        set((s) => ({ logs: [...s.logs.slice(-199), ev.data.line] }));
      } else {
        const q = ev.data;
        set((s) => {
          const jobs = { ...s.jobs };
          let jobOrder = s.jobOrder;
          let { runningSince, jobDurations } = s;
          switch (q.type) {
            case "started":
              if (jobs[q.jobId]) jobs[q.jobId] = { ...jobs[q.jobId], status: "running" };
              runningSince = Date.now();
              break;
            case "progress":
              if (jobs[q.jobId]) jobs[q.jobId] = { ...jobs[q.jobId], seconds: q.seconds };
              break;
            case "done":
              if (runningSince) jobDurations = [...jobDurations.slice(-19), Date.now() - runningSince];
              runningSince = null;
              delete jobs[q.jobId];
              jobOrder = jobOrder.filter((j) => j !== q.jobId);
              break;
            case "failed":
            case "cancelled":
              if (s.jobs[q.jobId]?.status === "running") runningSince = null;
              delete jobs[q.jobId];
              jobOrder = jobOrder.filter((j) => j !== q.jobId);
              break;
          }
          return { jobs, jobOrder, runningSince, jobDurations };
        });
        if (q.type === "done") {
          const proj = useProject.getState();
          if (q.sceneId) proj.addSceneTake(q.sceneId, q.take);
          else if (q.lineId) proj.addTake(q.lineId, q.take);
          for (const w of q.warnings) get().notify("warn", w);
          if (q.take.stopReason !== "complete") get().notify("warn", `最大長 (${q.take.stopReason}) で打ち切られました: ${q.take.text.slice(0, 20)}…`);
        } else if (q.type === "failed") {
          get().notify("error", `生成に失敗: ${q.message}`);
        }
      }
    });
  },

  saveSettings: async (s) => {
    // Update the UI at once (inputs are controlled by it), then persist.
    set({ settings: s });
    document.documentElement.dataset.theme = s.theme;
    await ipc.saveSettings(s);
  },
  activeProfile: () => {
    const s = get().settings;
    const eng = get().engine;
    const id = eng.state !== "stopped" && eng.profileId ? eng.profileId : s?.activeProfileId;
    return s?.profiles.find((p) => p.id === id) ?? s?.profiles[0];
  },
  activeAdapter: () => {
    const p = get().activeProfile();
    return get().adapters.find((a) => a.id === p?.adapter);
  },
  refreshVoices: async () => set({ voices: await ipc.voicesList() }),
  startEngine: async (profileId) => {
    const s = get().settings;
    if (s && s.activeProfileId !== profileId) await get().saveSettings({ ...s, activeProfileId: profileId });
    try {
      await ipc.engineStart(profileId);
    } catch (e) {
      // A failure after the process started is reported by the engine's "failed" event.
      if (get().engine.state !== "failed") get().notify("error", String(e));
    }
  },
  stopEngine: async () => {
    await ipc.engineStop();
  },
  enqueue: async (jobs) => {
    if (!jobs.length) return;
    set((s) => {
      const add: Record<string, JobInfo> = {};
      for (const j of jobs) add[j.jobId] = { lineId: j.lineId, sceneId: j.sceneId, status: "queued", seconds: 0 };
      return { jobs: { ...s.jobs, ...add }, jobOrder: [...s.jobOrder, ...jobs.map((j) => j.jobId)] };
    });
    await ipc.enqueue(jobs);
  },
  cancelAll: async () => {
    await ipc.cancelAll();
  },
  cancelLine: async (lineId) => {
    const ids = Object.entries(get().jobs).filter(([, j]) => j.lineId === lineId).map(([id]) => id);
    for (const id of ids) await ipc.cancelJob(id);
  },
  setBatch: (b) => set((s) => ({ batch: { ...s.batch, ...b } })),
  notify: (kind, text) => {
    const id = noticeSeq++;
    set((s) => ({ notices: [...s.notices.slice(-4), { id, kind, text }] }));
    setTimeout(() => get().dismiss(id), kind === "error" ? 12000 : 6000);
  },
  dismiss: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
  openDialog: (d) => set({ dialog: d }),
}));

/** Seconds until the queue is empty: the mean of the recent jobs × the jobs left, minus the running one's time so far. */
export function queueEta(remaining: number, durations: number[], runningSince: number | null, now = Date.now()): number | null {
  if (remaining === 0 || durations.length === 0) return null;
  const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
  const elapsed = runningSince !== null ? Math.min(now - runningSince, mean) : 0;
  return Math.max(0, (mean * remaining - elapsed) / 1000);
}
