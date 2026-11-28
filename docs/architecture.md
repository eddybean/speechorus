# Speechorus architecture

How Speechorus is built today. Keep this file current when the structure changes; the reasons behind the choices are
in [decisions/](decisions/README.md) (start with [D-00](decisions/D-00-speech-cpp-gui.md)), and known gaps and planned
work in [GitHub Issues](https://github.com/eddybean/speechorus/issues). The engine protocol and its measurements are in [engine-protocol.md](engine-protocol.md).

## Goal and scope

A Windows desktop studio for Japanese TTS, built around Drama-3-Japanese, with Irodori-TTS as the second model and
room for more. It is a GUI over [speech.cpp](https://github.com/nyosegawa/speech.cpp) (`speech.exe`, v0.11.2+, Vulkan
build); the app has no engine or CLI of its own and ships no model files.

What it does:

- **Script editor**: lines with a cast, text, per-line option overrides, silences and a memo; multi-select, drag,
  copy/paste of lines, auto-split on paste, txt/csv import (`キャラ,テキスト`), Undo/Redo.
- **Acting tags**: a searchable palette per model (Drama-3 brackets, Irodori emoji; NSFW hidden by default),
  highlighting in a CodeMirror line editor, recent tags, a voice-design prompt per cast.
- **Voices**: an app-wide library of `.voice.gguf` files made with `speech voice` from trimmed references with ASR
  transcripts, prompt-only voices, voice design from candidates, multi-speaker cast voices.
- **Generation**: a sequential queue (one line, selection, all, or only lines without takes), N takes per line, seeds
  random / fixed / incrementing / pasted, cancel, ETA. Scenes per line or in one request (D-01).
- **Takes**: play, star, select, delete, copy the seed; continuous playback with silences.
- **Export**: each line as WAV (file-name template), a combined WAV, SRT and .txt.
- **Models**: profiles (adapter, model, speech.exe, device, env), the download catalog, the speech.cpp download, a
  free-memory check before starting.

Out of scope: accent and pitch editing (not possible with LLM-type models), and for now mp3/ogg and recording
(issues #47, #46).

## Structure

```
┌──────────────────── Tauri app (speechorus.exe) ────────────────────┐
│ React UI (WebView2)                                                │
│   app/ (TopBar, Rail, Page, StatusBar, menus, dialogs)             │
│   features/{script,tags,cast,voices,takes,generate,models,export,  │
│             settings,project}                                      │
│   store/ (zustand: project.ts with Undo, app.ts)  lib/ (ipc, types,│
│   player, text)                                                    │
│        │ invoke (commands.rs) / one event channel `vs://event`     │
│ Rust core (speechorus_lib)                                         │
│   engine/    EngineSupervisor: one resident worker, JSON Lines     │
│   models/    adapters: drama3, irodori (capabilities, options)     │
│   jobs/      GenerationQueue: one job at a time, takes to WAV      │
│   tools.rs   short-lived speech subcommands, model resolution      │
│   project.rs .vsproj + takes folder; work.rs scratch folder        │
│   voices.rs  voice library; audio.rs WAV join/peaks/trim/SRT       │
│   downloads.rs catalog downloads; installer.rs speech.cpp download │
│   memguard.rs free-memory check; settings.rs app settings          │
└────────┬───────────────────────────────────────────────────────────┘
         │ spawn
   speech worker <model> --device …        ← resident, one at a time
   speech voice / asr / models / devices / pull   ← short-lived
```

## Engine

- `EngineSupervisor` keeps one `speech worker <model>` child and speaks protocol 4 over stdin/stdout (stdout carries
  only the protocol; logs go to stderr and to the engine log). Requests: `synthesize` (streams base64 PCM chunks),
  `add_voice`, `count_tokens`, `info`, `cancel`. Switching models stops one worker and starts the next.
- Model names are resolved to file paths from `speech models --json` before any subcommand runs; an unfetched model
  is an error, and only the catalog dialog downloads (D-59).
- `engine_start` first checks free memory on the target device (D-58).
- speech.exe is found via `SPEECHORUS_SPEECH`, next to the app exe, then `.engine/` in debug builds (D-28).

## Model adapters

Each adapter declares `Capabilities` (tag syntax, sample rate, multi-speaker, transcript needed, …) and an
`OptionSpec` schema, and turns a `LineRequest` into a worker request. The worker rejects unknown members, so an
adapter sends only what its model takes. The UI builds option forms from the schema (`OptionForm.tsx`). Irodori strips
bracket cues and speaker tokens (D-04). Tag palettes: `assets/tags/*.json`; catalog: `assets/models/catalog.json`
(D-22).

## Data

- **Project** (`.vsproj`, JSON): `Project{version, id, name, takesDir, modelProfileId, cast[], lines[], scenes[],
  exportSettings}`; `Cast{id, name, voiceId, designPrompt, defaultOptions, color}`;
  `Line{id, castId, text, optionsOverride, preSilence, postSilence, takes[], selectedTakeId, memo}`;
  `Scene{id, name, lineIds, mode, takes[], selectedTakeId}`;
  `Take{id, seed, optionsSnapshot, file, duration, sampleRate, stopReason, createdAt, starred, text}`.
  Takes are WAVs in `<project>.takes/`, tied to the `.vsproj` by `id` and a marker file (D-49). `src/lib/types.ts`
  mirrors the Rust structs (camelCase).
- **Undo/Redo**: immer patches in `store/project.ts`; typing merges within 1.2 s, takes are not history (D-05), and
  saves keep the WAVs the history can bring back (D-40, D-41).
- **App settings** (`settings.json` in the app config dir): profiles, the active profile, speech.exe, the ASR model,
  theme, tags, recent projects, volume, memory guard. A `catalog.json` there overrides the bundled catalog.
- **Voice library**: app data dir, `voices/` (D-06); `voices.json` lists the voices.
- **Format versions** (D-61): `.vsproj`, `settings.json` and `voices.json` carry a `version`, upgraded on load by
  each file's `migrate`, and keep members a newer version added. A newer project is refused; an unreadable or newer
  `settings.json` / `voices.json` is moved or copied aside (`stored.rs`) and the user is told at start.
- **Scratch audio**: `work/<uuid>/` in the local app data dir, one per running instance (D-39).

## Front end

- zustand stores: `project.ts` (project and history) and `app.ts` (settings, engine state, queue, notices, the screen
  in the main pane).
- The rail switches the main pane between 台本, ボイス and モデル; 設定, 書き出し and the catalog are dialogs (D-54).
- Playback is one `<audio>` element through Web Audio for volume (D-29, D-46); the GUI decodes no audio, and waveform
  peaks and trimming are computed in Rust (D-31).
- `window.__speechorus` and the `vs-add-refs` event are debug handles for E2E (D-19).

## Verification

- Rust unit tests with the mock worker (`jobs::mock`): adapters, project files, WAV join/SRT, queue and cancel, memory
  check.
- Vitest (jsdom): text splitting, tags, Undo, stores and components.
- `src-tauri/tests/real_engine.rs`: E2E against the real engine when `VS_SPEECH_EXE` and the model variables are set.
- UI changes are checked in the running app (`npm run tauri dev`) driven over the WebView2 DevTools protocol.
- CI runs the same checks on every PR (D-50, D-52).
