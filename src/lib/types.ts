// Shapes shared with the Rust core (serde camelCase).

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type Options = Record<string, Json>;

export interface Take {
  id: string;
  seed: number | null;
  optionsSnapshot: Options;
  file: string;
  duration: number;
  sampleRate: number;
  stopReason: string;
  createdAt: number;
  starred: boolean;
  text: string;
}

export interface Cast {
  id: string;
  name: string;
  voiceId: string | null;
  designPrompt: string;
  defaultOptions: Options;
  color: string;
}

export interface Line {
  id: string;
  castId: string | null;
  text: string;
  optionsOverride: Options;
  preSilence: number;
  postSilence: number;
  takes: Take[];
  selectedTakeId: string | null;
  memo: string;
}

export interface Scene {
  id: string;
  name: string;
  lineIds: string[];
  mode: "single" | "perLine";
  takes: Take[];
  selectedTakeId: string | null;
}

export interface ExportSettings {
  fileTemplate: string;
  outDir: string;
  defaultPreSilence: number;
  defaultPostSilence: number;
}

export interface Project {
  version: number;
  /** Matches the takes folder's marker file; the core sets it on save (D-49). */
  id: string;
  name: string;
  /** The takes folder's name beside the `.vsproj` when it was last saved; the core sets it (D-49). */
  takesDir: string;
  modelProfileId: string | null;
  cast: Cast[];
  lines: Line[];
  scenes: Scene[];
  exportSettings: ExportSettings;
}

export interface ModelProfile {
  id: string;
  name: string;
  adapter: string;
  model: string;
  speechExe: string;
  device: string;
  threads: number | null;
  env: Record<string, string>;
  extraArgs: string[];
}

export interface AppSettings {
  version: number;
  profiles: ModelProfile[];
  activeProfileId: string | null;
  speechExe: string;
  asrModel: string;
  asrDevice: string;
  showNsfwTags: boolean;
  theme: "dark" | "light";
  recentTags: string[];
  recentProjects: string[];
  /** 0 to 2 (200%), as the slider shows it; the player applies a loudness curve. */
  playbackVolume: number;
  playbackMuted: boolean;
  /** System protection: how hard the free-memory check before an engine start is (D-58). */
  memoryGuard: MemoryGuard;
}

export type MemoryGuard = "off" | "low" | "standard" | "strict";

/** The free-memory check of an engine start (`memguard::MemoryCheck`). */
export interface MemoryCheck {
  level: MemoryGuard;
  device: string;
  description: string;
  gpu: boolean;
  /** Free now plus what the running engine frees when it stops. */
  free: number;
  reclaim: number;
  total: number;
  fileBytes: number;
  /** What the level asks to be free. */
  need: number;
  verdict: "fits" | "confirm" | "block";
}

export type StartResult =
  | { status: "started" }
  | { status: "confirm"; check: MemoryCheck }
  | { status: "blocked"; check: MemoryCheck };

export interface OptionSpec {
  name: string;
  label: string;
  kind: "int" | "float" | "bool" | "string";
  default: Json;
  min: number | null;
  max: number | null;
  step: number | null;
  help: string;
}

export interface Capabilities {
  tagSyntax: "brackets" | "emoji";
  tagPalette: string;
  designPrompt: "leading_cue" | "instructions";
  instructions: boolean;
  speed: boolean;
  multiSpeaker: boolean;
  multiSpeakerReliable: boolean;
  voiceNeedsTranscript: boolean;
  voiceAcceptsWav: boolean;
  sampleRate: number;
  maxSecondsPerRequest: number;
  licenseNote: string;
}

export interface AdapterDescriptor {
  id: string;
  displayName: string;
  capabilities: Capabilities;
  options: OptionSpec[];
}

export interface VoiceInput {
  path: string;
  transcript: string | null;
  speaker: number | null;
}

export interface Voice {
  id: string;
  name: string;
  family: string;
  file: string;
  sources: VoiceInput[];
  speakers: number;
  combinedFrom: string[];
  createdAt: number;
  note: string;
  /** A voice described in words only (no file). */
  prompt: string;
}

export type EngineState =
  | { state: "stopped" }
  | { state: "loading"; profileId: string }
  | { state: "ready"; profileId: string; model: Record<string, Json>; sampleRate: number }
  | { state: "failed"; profileId: string; message: string };

export type QueueEvent =
  | { type: "enqueued"; jobIds: string[] }
  | { type: "started"; jobId: string; lineId: string | null }
  | { type: "progress"; jobId: string; seconds: number; done: number | null }
  | { type: "done"; jobId: string; lineId: string | null; sceneId: string | null; take: Take; warnings: string[] }
  | { type: "failed"; jobId: string; lineId: string | null; message: string }
  | { type: "cancelled"; jobId: string; lineId: string | null }
  | { type: "idle" };

export type AppEvent =
  | { kind: "engine"; data: EngineState }
  | { kind: "engineLog"; data: { line: string } }
  | { kind: "queue"; data: QueueEvent }
  | { kind: "download"; data: DownloadProgress };

export interface LineRequest {
  text: string;
  voice: string | null;
  voiceFamily: string | null;
  designPrompt: string | null;
  options: Options;
  seed: number | null;
}

export interface JobSpec {
  jobId: string;
  lineId: string | null;
  sceneId: string | null;
  request: LineRequest;
  voicePath: string | null;
  outDir: string;
  fileStem: string;
}

export interface ExportItem {
  path: string;
  text: string;
  cast: string;
  preSilence: number;
  postSilence: number;
  seed: number | null;
}

export interface Cue {
  start: number;
  end: number;
  text: string;
  cast: string;
}

export interface TagCategory {
  id: string;
  label: string;
  nsfw?: boolean;
  tags: (string | { tag: string; label: string; help: string })[];
}

export interface TagPaletteData {
  id: string;
  syntax: "brackets" | "emoji";
  categories: TagCategory[];
}

export interface DownloadProgress {
  id: string;
  phase: "checking" | "downloading" | "verifying" | "done" | "failed" | "cancelled";
  file: string;
  done: number;
  total: number;
  bytesPerSec: number;
  etaSecs: number | null;
  message: string;
  profileId: string | null;
}

export interface CatalogFile {
  name: string;
  size: number;
  sha256: string;
  role: "model" | "sidecar";
}

export interface CatalogVariant {
  id: string;
  label: string;
  supported?: boolean;
  unsupportedReason?: string;
  vramBytes: number;
  files: CatalogFile[];
  /** Already in speech.cpp's model folder (`speechPull` models only, D-59). */
  fetched?: boolean;
}

export interface CatalogModel {
  id: string;
  name: string;
  task: "synthesis" | "recognition";
  adapter: string;
  description: string;
  source: { kind: "huggingface"; repo: string; revision: string } | { kind: "speechPull"; name: string };
  license: { name: string; url: string; summary: string; requiresConsent: boolean };
  env: Record<string, string>;
  device: string;
  defaultVariant: string;
  variants: CatalogVariant[];
}

export interface CatalogView {
  catalog: { version: number; models: CatalogModel[] };
  recommended: Record<string, string>;
  gpu: { name: string; free: number; total: number } | null;
  defaultDir: string;
  running: string[];
}
