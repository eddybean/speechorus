# D-00 A GUI over speech.cpp's resident worker; no engine or CLI of our own

- **Status**: Accepted (2026-11-26, the first plan; user decisions marked)
- **Code**: `src-tauri/src/engine/`, `src-tauri/src/models/`, `src-tauri/src/tools.rs`

## Context

The goal was an easy Japanese TTS app built around Drama-3-Japanese, with model switching (Irodori-TTS and others)
designed in from the start. The engine had to be a standalone TTS that also runs from the command line.

What existed:

- [speech.cpp](https://github.com/nyosegawa/speech.cpp) (MIT): one `speech` executable with `tts`, `voice`, `serve`
  (OpenAI-compatible HTTP), `worker` (JSON Lines, model stays loaded), `asr`, `info`/`devices`/`models --json` and
  `pull`. It runs Drama-3, the Irodori-TTS family, Qwen3-TTS and several ASR models.
- Mixomo/Fish_Drama_3_Easy_GUI (Gradio): a fixed model list without the Japanese GGUF, no tag UI, no projects, no
  per-line settings. The `speech serve --open` page and the official Irodori Gradio page are minimal.

## Decision

- Build only the GUI: Tauri 2 + React + TypeScript (user decision), and use speech.cpp as is. No CLI of our own
  (user decision): speech.cpp already is the CLI.
- Talk to one resident `speech worker <model>` process over stdin/stdout. Run `voice`, `asr`, `models`, `devices` and
  `pull` as short-lived processes. One engine process at a time; switching models stops one and starts the next.
- Each model is an adapter (`models/`) that declares its capabilities and option schema; the UI builds its forms from
  the schema, and the tag palette is data per model (`assets/tags/*.json`).
- Keep the GUI light (target 200 MB or less): it loads no model and decodes no audio. Playback is an `<audio>`
  element on WAV files through the asset protocol.
- The main configuration is NVIDIA 24 GB+ with Drama-3 Q4_K/Q5_K on the official Vulkan build (user decision);
  a custom binary path covers builds such as patched CUDA for IQ3_XXS.
- The app ships no GGUF files; the user points at them or downloads them (D-25, D-59).

## Alternatives not taken

- **`speech serve`**: it registers voices only at startup, so adding a voice would mean reloading a 20 GB model. The
  worker has `add_voice`.
- **Extending the existing Gradio GUI**: too far from the requirements (above).
- **Accent and pitch editing** (as in VOICEVOX/AivisSpeech): not possible with LLM-type models, so out of scope.
- **mp3/ogg export**: would need ffmpeg; out of scope.

## Consequences

- Every engine feature depends on speech.cpp's worker protocol (now protocol 4); see `docs/engine-protocol.md`
  before touching `engine/` or the adapters.
- Adding a model speech.cpp does not run would need an engine backend trait; only the adapter boundary exists today.
- Drama-3 weights are under the Fish Audio Community License (limits on commercial use); the app shows it where the
  model is chosen or downloaded.
