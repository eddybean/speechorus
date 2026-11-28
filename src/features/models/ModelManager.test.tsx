import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ModelManager, fetchedIrodori, fetchedState } from "./ModelManager";
import { useApp } from "../../store/app";
import { ipc } from "../../lib/ipc";
import type { AdapterDescriptor, AppSettings, ModelProfile } from "../../lib/types";

vi.mock("../../lib/ipc", () => ({
  ipc: {
    listDevices: vi.fn(async () => ({ devices: [] })),
    modelCatalog: vi.fn(async () => ({ models: [] })),
    speechVersion: vi.fn(async () => "speech 0.11.2"),
  },
}));

const profile = (id: string, name: string, env: Record<string, string>, extraArgs: string[]): ModelProfile => ({
  id,
  name,
  adapter: "irodori",
  model: "/m.gguf",
  speechExe: "speech",
  device: "auto",
  threads: null,
  env,
  extraArgs,
});
const settings: AppSettings = {
  version: 1,
  profiles: [profile("p1", "Drama-3", { GGML_VK_DISABLE_F16: "1" }, ["--foo"]), profile("p2", "Irodori Small", {}, [])],
  activeProfileId: "p1",
  speechExe: "speech",
  asrModel: "",
  asrDevice: "auto",
  showNsfwTags: false,
  theme: "dark",
  recentTags: [],
  recentProjects: [],
  playbackVolume: 1,
  playbackMuted: false,
  memoryGuard: "standard",
};
const adapter: AdapterDescriptor = {
  id: "irodori",
  displayName: "Irodori-TTS",
  capabilities: {
    tagSyntax: "emoji",
    tagPalette: "irodori",
    designPrompt: "instructions",
    instructions: true,
    speed: true,
    multiSpeaker: false,
    multiSpeakerReliable: false,
    voiceNeedsTranscript: false,
    voiceAcceptsWav: true,
    sampleRate: 48000,
    maxSecondsPerRequest: 30,
    licenseNote: "MIT",
  },
  options: [],
};

const saveSettings = vi.fn(async (_s: AppSettings) => {});

describe("ModelManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useApp.setState({
      settings,
      adapters: [adapter],
      engine: { state: "stopped" },
      view: "models",
      saveSettings,
      downloads: {},
      engineStarting: null,
      dialog: null,
    });
  });

  it("shows each profile's own env and extra args when another profile is picked", () => {
    render(<ModelManager />);
    const env = () => (screen.getByLabelText(/環境変数/) as HTMLTextAreaElement).value;
    const args = () => (screen.getByLabelText(/追加の引数/) as HTMLInputElement).value;
    expect(env()).toBe("GGML_VK_DISABLE_F16=1");
    expect(args()).toBe("--foo");

    fireEvent.click(screen.getByRole("button", { name: "Irodori Small" }));
    expect(env()).toBe("");
    expect(args()).toBe("");

    // Leaving the field must not copy the first profile's env into this one.
    fireEvent.blur(screen.getByLabelText(/環境変数/));
    const calls = saveSettings.mock.calls;
    const saved = calls[calls.length - 1]?.[0];
    expect(saved?.profiles.find((p) => p.id === "p2")?.env ?? {}).toEqual({});
  });

  it("offers only fetched Irodori models, and sends a profile with a missing one to the catalog (D-59)", async () => {
    vi.mocked(ipc.modelCatalog).mockResolvedValue({ models: speechCatalog });
    useApp.setState({
      settings: {
        ...settings,
        activeProfileId: "p2",
        profiles: [{ ...settings.profiles[1], model: "irodori-tts-large" }],
      },
    });
    render(<ModelManager />);
    expect(await screen.findByText(/まだダウンロードされていません/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "irodori-tts-mf (1.92 GB)" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /irodori-tts-large \(/ })).toBeNull();
    expect((screen.getByRole("button", { name: "このモデルで起動（切替）" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "カタログから入手…" }));
    expect(useApp.getState().dialog).toBe("catalog");
  });
});

const file = (type: string, size: number, fetched: boolean) => ({ type, size, fetched, path: `C:/m/${type}.gguf` });
const speechCatalog = [
  { name: "irodori-tts-mf", task: "synthesis", type: "f16", languages: ["ja"], files: [file("f16", 1.92e9, true)] },
  {
    name: "irodori-tts-large",
    task: "synthesis",
    type: "q8_0",
    languages: ["ja"],
    files: [file("q8_0", 3.88e9, false), file("q4_k", 2.62e9, true)],
  },
  { name: "qwen3-tts-0.6b", task: "synthesis", type: "q8_0", languages: ["ja"], files: [file("q8_0", 1e9, true)] },
];

describe("fetchedState / fetchedIrodori", () => {
  it("looks a catalog name up with its default or given quantization; paths are not looked up", () => {
    expect(fetchedState(speechCatalog, "irodori-tts-large")).toBe("missing");
    expect(fetchedState(speechCatalog, "irodori-tts-large:q4_k")).toBe("fetched");
    expect(fetchedState(speechCatalog, "irodori-tts-mf")).toBe("fetched");
    expect(fetchedState(speechCatalog, "E:\\models\\x.gguf")).toBeNull();
    expect(fetchedState(speechCatalog, "unknown")).toBeNull();
    expect(fetchedState(speechCatalog, "")).toBeNull();
  });

  it("lists fetched Irodori files, naming a non-default quantization", () => {
    expect(fetchedIrodori(speechCatalog).map((m) => m.value)).toEqual(["irodori-tts-mf", "irodori-tts-large:q4_k"]);
  });
});
