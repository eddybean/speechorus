// Typed wrappers of the Tauri commands in src-tauri/src/commands.rs.
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  CatalogView,
  AdapterDescriptor, AppEvent, AppSettings, Cue, EngineState, ExportItem, JobSpec, ModelProfile, Project, Voice, VoiceInput, Json,
} from "./types";

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const ipc = {
  getSettings: () => invoke<AppSettings>("get_settings"),
  saveSettings: (settings: AppSettings) => invoke<void>("save_settings", { settings }),
  newProfile: (adapter: string, id: string, name: string, model: string, speechExe: string) =>
    invoke<ModelProfile>("new_profile", { adapter, id, name, model, speechExe }),
  listAdapters: () => invoke<AdapterDescriptor[]>("list_adapters"),
  speechVersion: (exe: string) => invoke<string>("speech_version", { exe }),
  listDevices: () => invoke<{ devices: { name: string; description: string; kind: string; memory_total: number; memory_free: number }[] }>("list_devices"),
  modelCatalog: () => invoke<{ models: { name: string; task: string; languages: string[]; files: { type: string; size: number; fetched: boolean; path: string }[] }[] }>("model_catalog"),
  modelInfo: (profileId: string) => invoke<{ path: string; info: Record<string, Json>; sidecar: boolean }>("model_info", { profileId }),
  engineState: () => invoke<EngineState>("engine_state"),
  engineStart: (profileId: string) => invoke<void>("engine_start", { profileId }),
  engineStop: () => invoke<void>("engine_stop"),
  enqueue: (jobs: JobSpec[]) => invoke<void>("enqueue", { jobs }),
  cancelJob: (jobId: string) => invoke<void>("cancel_job", { jobId }),
  cancelAll: () => invoke<void>("cancel_all"),
  countTokens: (text: string) => invoke<number>("count_tokens", { text }),
  voicesList: () => invoke<Voice[]>("voices_list"),
  voiceTranscribe: (path: string) => invoke<string>("voice_transcribe", { path }),
  voiceCreate: (profileId: string, name: string, inputs: VoiceInput[], note?: string) =>
    invoke<Voice>("voice_create", { profileId, name, inputs, note: note ?? null }),
  voiceCombine: (profileId: string, voiceIds: (string | null)[], name?: string) => invoke<Voice | null>("voice_combine", { profileId, voiceIds, name: name ?? null }),
  installSpeech: () => invoke<AppSettings>("install_speech"),
  wavPeaks: (path: string, buckets: number) => invoke<{ duration: number; sampleRate: number; peaks: [number, number][] }>("wav_peaks", { path, buckets }),
  wavTrim: (path: string, start: number, end: number) => invoke<string>("wav_trim", { path, start, end }),
  voiceCreatePrompt: (family: string, name: string, prompt: string, note?: string) =>
    invoke<Voice>("voice_create_prompt", { family, name, prompt, note: note ?? null }),
  catalogList: () => invoke<CatalogView>("catalog_list"),
  catalogDownload: (modelId: string, variantId: string, destDir: string, licenseAccepted: boolean) =>
    invoke<string>("catalog_download", { modelId, variantId, destDir, licenseAccepted }),
  downloadCancel: (id: string) => invoke<void>("download_cancel", { id }),
  voiceUpdate: (voice: Voice) => invoke<void>("voice_update", { voice }),
  voiceDelete: (id: string) => invoke<void>("voice_delete", { id }),
  projectNew: () => invoke<string>("project_new"),
  projectSave: (path: string, project: Project, fromTakesDir: string | null) =>
    invoke<string>("project_save", { path, project, fromTakesDir }),
  projectLoad: (path: string) => invoke<{ project: Project; takesDir: string; path: string }>("project_load", { path }),
  projectPrune: (project: Project, takesDir: string) => invoke<number>("project_prune", { project, takesDir }),
  readTextFile: (path: string) => invoke<string>("read_text_file", { path }),
  allowFile: (path: string) => invoke<void>("allow_file", { path }),
  exportJoined: (req: { items: ExportItem[]; wavPath: string; srt: boolean; txt: boolean; srtWithCast: boolean }) =>
    invoke<{ files: string[]; cues: Cue[] }>("export_joined", { req }),
  exportEach: (items: ExportItem[], dir: string, template: string, writeTxt: boolean) =>
    invoke<{ files: string[] }>("export_each", { items, dir, template, writeTxt }),
  deleteFile: (path: string) => invoke<void>("delete_file", { path }),
  processMemory: () => invoke<number>("process_memory"),
};

export function onAppEvent(cb: (e: AppEvent) => void): Promise<() => void> {
  if (!inTauri) return Promise.resolve(() => {});
  return listen<AppEvent>("vs://event", (e) => cb(e.payload));
}

export function fileUrl(path: string): string {
  return inTauri ? convertFileSrc(path) : path;
}

export function joinPath(dir: string, file: string): string {
  if (!dir) return file;
  const sep = dir.includes("\\") ? "\\" : "/";
  return dir.endsWith("\\") || dir.endsWith("/") ? dir + file : dir + sep + file;
}
