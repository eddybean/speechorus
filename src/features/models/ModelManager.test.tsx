import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ModelManager } from "./ModelManager";
import { useApp } from "../../store/app";
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
    useApp.setState({ settings, adapters: [adapter], engine: { state: "stopped" }, view: "models", saveSettings });
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
});
