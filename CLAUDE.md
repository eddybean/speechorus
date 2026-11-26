# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Speechorus (repo folder `voice-studio`; renamed in D-36) is a Windows desktop Japanese TTS studio: Tauri 2 + React 18 + TypeScript on the front, Rust core behind it, and the external [speech.cpp](https://github.com/nyosegawa/speech.cpp) `speech.exe` (v0.11.2+, Vulkan build) as the engine. Main model: Drama-3-Japanese (Q4_K/Q5_K, Vulkan only, needs `GGML_VK_DISABLE_F16/COOPMAT/COOPMAT2=1`, and its `.gguf.json` sidecar next to the GGUF). Second model: Irodori-TTS. The app ships no GGUF files. The UI text is Japanese.

## Commands

```sh
npm install
npm run tauri dev            # run the app (Vite on port 1420, strictPort)
npm test                     # vitest (jsdom, globals)
npx vitest run src/lib/text.test.ts        # one test file
npx vitest run -t "test name"              # by test name
npm run lint                 # tsc -b --noEmit
npm run test:rust            # cargo test, using the mock worker
cargo test --manifest-path src-tauri/Cargo.toml <test_name>   # one Rust test
npm run lint:rust            # clippy, all targets, -D warnings
npx tauri build --no-bundle
```

E2E against the real engine (`src-tauri/tests/real_engine.rs`; each section is skipped when its env var is not set):

```sh
VS_SPEECH_EXE=.engine/speech.exe VS_DRAMA_MODEL=E:/models/Drama-35B-A3B-Japanese-v3-Q4_K.gguf VS_IRODORI_MODEL=irodori-tts-mf \
  cargo test --manifest-path src-tauri/Cargo.toml --test real_engine -- --nocapture --test-threads=1
```

`speech.exe` is looked up in this order: `SPEECHORUS_SPEECH`, next to the app exe (`speech/speech.exe`, `speech.exe`), then `.engine/speech.exe` (debug builds only). `.engine/` is gitignored.

## Architecture

**Engine process.** `engine::EngineSupervisor` keeps one resident `speech worker <model>` child process and talks JSON Lines over stdin/stdout (protocol 4; stdout carries only the protocol, logs go to stderr). It handles `synthesize` (streams base64 PCM `chunk`s), `add_voice`, `count_tokens`, `info` and `cancel`. Switching models stops one worker and starts the next. `speech voice`, `speech asr` and `speech pull` run as short-lived processes. Model catalog names (e.g. `irodori-tts-mf`) are resolved to file paths with `speech pull` before use (D-02). The protocol details and measurements are in `docs/engine-protocol.md`: read it before touching `engine/` or the adapters.

**Model adapters** (`src-tauri/src/models/`). Each model declares `Capabilities` (tag syntax brackets/emoji, sample rate, multi-speaker support, and so on) and an `OptionSpec` schema, and turns a `LineRequest` into a worker request. The worker rejects any member it does not know (`invalid_argument`), so an adapter must send only options its model takes. The UI builds its option forms from the schema (`features/models/OptionForm.tsx`). Irodori strips `[..]` cues and `<|speaker:N|>` before sending (D-04). The tag palettes are `assets/tags/*.json`; the download catalog is `assets/models/catalog.json`.

**Jobs.** `jobs::GenerationQueue` runs one job at a time on the worker and writes each take to a WAV in the project's takes folder. `jobs::mock` is a fake worker used by the Rust unit tests.

**Core → UI.** All events go over one Tauri channel, `vs://event`, as `AppEvent` (`Engine`, `EngineLog`, `Queue`, `Download`), tagged `{kind, data}`. Commands are registered in `lib.rs` and defined in `commands.rs`, and `src/lib/ipc.ts` holds typed wrappers for them. When you add or change a command, update all three, plus `src/lib/types.ts`, which mirrors the Rust structs. Rust structs serialize as camelCase (`#[serde(rename_all = "camelCase")]`); keep it that way.

**Frontend state.** It uses zustand.
- `src/store/project.ts` holds the project (cast, lines, takes) with an immer patch Undo/Redo history. Typing on the same line within `MERGE_MS` (1.2 s) is one Undo step. Takes arriving from the engine are not part of the history (D-05).
- `src/store/app.ts` holds settings, the engine state, the queue, notices and the chosen profile.
- `src/features/*` holds the UI by feature (script, tags, voices, takes, models, export, generate, settings, cast).
- Playback is an HTML `<audio>` element pointed at WAV files through the asset protocol (`src/lib/player.ts`); the GUI decodes no audio itself. Waveform peaks and trimming are computed in Rust (`wav_peaks`, `wav_trim`).

**Persistence.**
- A project is a `.vsproj` JSON file plus a `<project>.takes/` folder of WAVs. `project_prune` removes WAVs that are no longer referenced.
- App settings (model profiles: adapter, GGUF, speech.exe, device, env) are stored in the app config dir as `settings.json`. A `catalog.json` there overrides the bundled catalog.
- The voice library (`.voice.gguf` files) lives in the app data dir under `voices/`.

**Debug handles.** For E2E driven over DevTools, `window.__speechorus` exposes the stores and actions (D-19), and the window event `vs-add-refs` adds reference audio by path (D-35).

## Project process

- `docs/architecture.md` is the approved plan. Every departure from it is recorded in `docs/deviations.md` as a `D-NN` entry (what / why / workaround / user impact, plus a status tag). Confirm large changes that affect a requirement with the user before making them, and add a D-entry for any deviation. Commit messages refer to these IDs (e.g. "(D-37)").
- Known engine limitation: a single-request `<|speaker:N|>` scene with Drama-3-Japanese voices only speaker 0, so per-line scene mode is the default (D-01).
