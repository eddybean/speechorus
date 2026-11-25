# Speechorus: a GUI for speech.cpp (Drama-3-Japanese first, Irodori-TTS second)

## Context
The goal is an easy-to-use Japanese TTS app built mainly around Drama-3-Japanese (`StudioYebisu-ship-it/Drama-3-Japanese-speech-cpp-gguf`). Model switching (Irodori-TTS and others) is part of the design from the start. `E:\Work\src\voice-studio` is empty and not a git repository, so this is a new build. This session only does research and planning. **Implementation and testing are handed to a separate new session.**

### Research findings (the basis for the decisions)
- **TTS engine: use the existing speech.cpp as is** (https://github.com/nyosegawa/speech.cpp, MIT, v0.11.2+)
  - It is a single executable `speech` that runs from the CLI. That meets the requirement for a standalone, CLI-runnable TTS engine. We add no CLI of our own (user decision).
  - Synthesis models it supports: `drama-3`, `irodori-tts` / `irodori-tts-mf` / `irodori-tts-large`, `qwen3-tts-*`. It also has ASR (`qwen3-asr-0.6b`, `reazonspeech-v2`, and others).
  - Subcommands: `tts`, `voice` (builds a voice file from reference audio), `serve` (OpenAI-compatible HTTP), `worker` (JSON Lines over stdin/stdout, model stays loaded), `asr`, `info --json`, `devices --json`, `models --json`, `pull`.
  - The Windows release is a Vulkan build only. With 24 GB or more of NVIDIA VRAM, the Japanese Q4_K/Q5_K runs on the official Vulkan binary (`GGML_VK_DISABLE_F16/COOPMAT/COOPMAT2=1` required; **CUDA is not allowed for Q4_K/Q5_K**). The `.gguf.json` sidecar must sit next to the model.
- **Existing freeware**
  - Mixomo/Fish_Drama_3_Easy_GUI (Gradio, Windows only, 1 commit): the model list is fixed and does not include the Japanese GGUF. It has no tag-insertion UI, no project saving and no per-line settings. **It does not meet the requirements.**
  - The `speech serve --open` web page and the official Irodori Gradio page are both minimal. **The decision is to build only the GUI ourselves.**
- **Drama-3 features (what the GUI must expose)**
  - Acting tags: `[驚いて]本当に？[明るく]…`. A tag takes effect from the point where it is written. TAG_LIST.md has about 130 general tags plus an NSFW category.
  - Free-text voice design: a description at the start of the text, e.g. `[落ち着いた25歳の女性。…]`, used with `voice=none`.
  - Multiple speakers: `<|speaker:0..15|>` covers a whole scene in one request. Several references can be combined into a single cast voice with `speech voice … --speaker N`.
  - Reference audio: `speech voice drama-3 ref.wav --transcript "…" out.voice.gguf` (a transcript is required).
  - Options: `seed`, `temperature` (1), `top_k` (30), `top_p` (0.9), `max_seconds` (47.6, max 95.1), `experts_on_cpu`. **It has no speed, pitch or `instructions` options** (sending them returns 400).
  - Output is WAV (44.1 kHz, check `X-Sample-Rate`). Long text is split automatically into chunks of about 300 bytes, up to 8192 tokens.
- **Irodori-TTS**: `instructions` (VoiceDesign caption), `speed`, `steps`, `seconds`, `duration_scale`, cfg_*, 56 emoji tags. A reference WAV can be used directly with no transcript. Output is 48 kHz, up to 30 s per request.
- **Feature inventory (AivisSpeech/VOICEVOX)**: multi-line editor, per-line speaker, txt import (`キャラ,テキスト` format), per-line playback, play all, export each line as a WAV (filename template, serial numbers), .txt/.lab, project save, Undo/Redo, presets, drag to reorder, keyboard shortcuts, auto-split on paste, memo syntax. Accent and intonation editing **cannot be offered for an LLM-type model**, so it is out of scope.

### User decisions
- GPU: NVIDIA 24 GB or more, so the main configuration is Q4_K on Vulkan with the official binary. IQ3_XXS (patched CUDA build) is a "custom binary path" option only.
- GUI: Tauri 2 + React + TypeScript.
- CLI: speech.cpp only (no CLI of our own).
- v1 scope: script editor with batch generation, take management, automatic transcription of reference audio, Irodori-TTS support.

## Architecture

```
┌───────────── Tauri app (speechorus) ─────────────┐
│ React UI (WebView2)                               │
│   ScriptEditor / TagPalette / VoiceLibrary /      │
│   TakePanel / ModelManager / ExportDialog         │
│        │ invoke / events                          │
│ Rust core                                         │
│   engine::  EngineSupervisor (child process,      │
│             lifecycle, model switching)           │
│   models::  ModelAdapter trait                    │
│             ├ Drama3Adapter                       │
│             └ IrodoriAdapter                      │
│   jobs::    GenerationQueue (sequential, cancel,  │
│             progress)                             │
│   project:: .vsproj (JSON) + takes/ folder        │
│   audio::   WAV concat/silence/SRT/.txt export    │
│             (hound)                               │
└────────┬──────────────────────────────────────────┘
         │ spawn (one resident process)
   speech worker <model.gguf> --device Vulkan0 …   ← model stays loaded
   speech voice … / speech asr …                   ← short-lived processes
```

### Key design points
1. **Model switching (ModelAdapter trait, Rust)**
   - Each model declares the following:
     - `capabilities()`: tag syntax (brackets or emoji), whether it supports instructions, speed, multiple speakers, whether reference audio needs a transcript, sample rate.
     - `option_schema()`: name, type, default, range.
   - `build_request(line, voice, options)` turns one line into the JSON sent to speech.cpp.
   - `prepare_voice(ref_wavs, transcripts)` builds the `speech voice` arguments.
   - The UI generates its settings panel dynamically from `option_schema`. The base schema can come from `speech info --json`; the adapter supplies UI hints (labels, slider ranges).
   - The tag palette data is defined per model (`assets/tags/drama3.json`, `irodori-emoji.json`).
   - Adding a model that is not on speech.cpp later means adding an `EngineBackend` trait (with `SpeechCppBackend` as its first implementation). In v1 only the trait boundary exists.
2. **Talking to the engine: `speech worker` (JSON Lines), with `serve` as the fallback**
   - Reason: `serve` registers voices only at startup. Adding a voice would mean reloading a 20 GB model. The worker has messages such as `add_voice`.
   - **First task for the implementation session:** read `docs/worker.md` (the fetch failed in this session) and confirm the request/response fields, `add_voice`, progress and cancel. If they are missing, use `serve` and restart it with `--add-voice` whenever a voice is added.
   - Only one engine process at a time. Switching models means stopping the current one, then starting the next. The UI shows the loading state.
   - Show the VRAM requirement and free VRAM up front (`speech devices --json`).
3. **Keep memory low**
   - The GUI stays at about 100–200 MB (Tauri/WebView2).
   - The GUI loads no audio decoding or model of its own.
   - Playback goes through an HTML `<audio>` element pointed at a temporary WAV file via the asset protocol.
   - ASR runs as a separate short-lived process (`speech asr qwen3-asr-0.6b ref.wav`) that exits after use.
   - **Risk to verify:** `speech voice drama-3` may load the whole model again (the default device is CPU). Measure memory and time during implementation. If it is too heavy, (a) check whether the worker can build voices, otherwise (b) stop the worker temporarily while the voice is built.
4. **Data model (`.vsproj`, JSON)**
   - `Project{ version, model_profile_id, cast[], lines[], export_settings }`
   - `Cast{ id, name, voice_ref(voice.gguf | none), design_prompt?, default_options, color }`
   - `Line{ id, cast_id, text, options_override, pre_silence, post_silence, takes[], selected_take_id, memo }`
   - `Take{ id, seed, options_snapshot, wav_path, duration, stop_reason, created_at, starred }`
   - Takes are saved as WAV files in the `<project>.takes/` folder.
   - `ModelProfile{ id, adapter: "drama3"|"irodori", gguf_path, speech_exe, device, env, extra_args }` lives in the app settings. For Vulkan Drama-3 the three `GGML_VK_DISABLE_*` env vars are on by default.

## v1 features
- **Script editor**
  - List of lines; each has a speaker selector, a text field, per-line overrides and a memo.
  - Shift+Enter adds a line, drag reorders, multi-select (Shift/Ctrl). Copy, paste and duplicate lines.
  - Auto-split on paste (by 。 and newlines). Undo/Redo (zustand + an immer patch history).
  - txt/csv import (`キャラ名,テキスト` compatible with VOICEVOX).
- **Acting tag support**
  - A searchable, categorized tag palette (click to insert at the cursor). The NSFW category is hidden by default and can be shown in Settings.
  - Highlight `[...]` and `<|speaker:N|>` (CodeMirror 6, single-line mode).
  - Free-input tags and a recently-used list.
  - A field for the voice design prompt (Drama-3: inserted as a leading tag; Irodori: `instructions`).
- **Voice library**
  - Pick a reference WAV (recording optional; v2). Automatic transcription with speech.cpp ASR, which the user can edit.
  - Run `speech voice` to save a `.voice.gguf`. A cast can also be `voice=none` with only a design prompt.
  - Combine several references into a multi-speaker voice (`--speaker`).
- **Generation and takes**
  - Generate one line, selected lines, all lines, or only lines that have no take yet.
  - Sequential queue with progress, cancel and ETA. N takes per line (seeds: random / fixed / incrementing).
  - Take list: play, star, select, delete. Re-roll with the same seed for reproduction.
  - Show the `stop_reason=max_seconds` warning.
- **Scene mode (Drama-3 only)**: generate several lines in one request with `<|speaker:N|>`, using the cast voice. The output is one WAV (no per-line split).
- **Playback**: play a single line, continuous play from the selected line (selected takes plus silence), stop, Space key.
- **Export**
  - Each line as a WAV (filename template `{index}_{cast}_{text8}`, serial numbers to avoid overwrites).
  - A combined WAV (with per-line pre/post silence).
  - SRT built from the cumulative durations, and a .txt file.
- **Model management**
  - Register, edit and switch model profiles. Pick the speech.exe path; a button runs `install.ps1` or downloads the release zip.
  - Show the GGUF path and the sidecar check. Device selection.
  - Show Irodori models from `speech pull` and `speech models --json`.
- **Settings and UX**: presets (option sets per cast), dark/light theme, Japanese UI (i18n ready), keyboard shortcuts.
- **Out of scope (v2 and later)**: accent and pitch editing (not possible with the models), mp3/ogg (would need an ffmpeg dependency), .lab, recording, AivisHub-style model distribution.

## Repository layout (proposed)
```
voice-studio/   (repository folder; the app was renamed to Speechorus, see D-36)
  src-tauri/            Rust: main.rs, engine/, models/{mod,drama3,irodori}.rs, jobs/, project/, audio/
  src/                  React: app/, features/{script,tags,voices,takes,models,export}/, lib/ipc.ts
  assets/tags/          drama3.json (built from TAG_LIST.md), irodori-emoji.json
  docs/                 architecture.md, engine-protocol.md (worker findings)
```
Main dependencies: Tauri 2, React 18, TypeScript, Vite, zustand, CodeMirror 6, dnd-kit; Rust: tokio, serde, hound, thiserror.

## Implementation order (the brief for the new session)
1. `git init`, Tauri 2 + React scaffold, CI-equivalent lint/test setup.
2. **Engine verification spike**:
   - Read the worker.md protocol.
   - With the real `speech.exe`, check Drama-3 Q4_K: `tts`, `voice`, `worker` (memory and time), plus `asr`.
   - Record the results in `docs/engine-protocol.md`.
3. Rust core: ModelProfile, EngineSupervisor, Drama3Adapter, GenerationQueue, with unit tests (fake engine using a mock worker).
4. UI: script editor, tag palette, single-line generation and playback.
5. Takes, batch generation, cancel, project save/load.
6. Voice library (ASR transcription, `speech voice`), scene mode.
7. Export (WAV each line / combined / SRT).
8. IrodoriAdapter, then check model switching end to end.

## Verification
- Rust: `cargo test` (adapter request generation, project serialization, WAV concat/SRT time calculation, queue cancellation with a mock engine).
- Frontend: `vitest` (tag insertion, paste splitting, Undo).
- E2E (manual or scripted):
  - Load Drama-3 Q4_K on Vulkan0.
  - Generate 3 lines including a tag, 2 takes per line.
  - Build a voice from a reference WAV, with automatic transcription, and generate.
  - Generate a 2-speaker scene.
  - Export a combined WAV and SRT, and check timings.
  - Switch to Irodori-TTS-mf and generate with an emoji tag and `instructions`.
- Memory: measure the GUI's working set with Task Manager while the engine runs (target 200 MB or less).

## Notes
- Drama-3 weights are under the Fish Audio Community License (limits on commercial use). Show this on the model profile screen.
- Large files (GGUF) are never shipped with the app. The user specifies their paths.
