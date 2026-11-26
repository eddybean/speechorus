# Speechorus

A lightweight Japanese TTS studio (Tauri 2 + React) that uses [speech.cpp](https://github.com/nyosegawa/speech.cpp) as its engine.
The main model is **Drama-3-Japanese** (`StudioYebisu-ship-it/Drama-3-Japanese-speech-cpp-gguf`). **Irodori-TTS** is also supported, and you can switch between them.

- Script editor: cast per line, drag to reorder, multi-select, auto-split on paste, Undo/Redo, txt/csv import (`キャラ,テキスト`)
- Highlighting of acting tags `[驚いて]` and `<|speaker:N|>`, and a tag palette (from TAG_LIST.md; the NSFW tags are hidden by default)
- Takes: N per line, seeds (random / fixed / sequential), favorite (☆), select, re-generate with the same seed, warning when a take hits the length limit
- Batch generation (selected lines, lines without a take, all lines), sequential queue with progress and cancel
- Voice library: reference WAV → automatic transcription by ASR (qwen3-asr-0.6b) → `speech voice` creates a `.voice.gguf`
- Scenes: per line (each cast uses its own voice), or a single request with `<|speaker:N|>` (the cast voices are merged automatically)
- Export: one WAV per line (filename template with serial numbers) / combined WAV (with silence before and after) / SRT / txt
- **Model catalog**: download Drama-3-Japanese (Q4_K/Q5_K + sidecar), Irodori-TTS-mf and Qwen3-ASR from inside the app (resumable, SHA-256 checked, license consent, VRAM-based recommendation, profile created automatically). Catalog: `assets/models/catalog.json`
- Model profiles: speech.exe (can be downloaded from the official release), GGUF (or a catalog name), device, environment variables; checks for the sidecar and the VRAM needed

## Requirements

- Windows 10/11 with WebView2
- The official Windows release of speech.cpp v0.11.2 or later (Vulkan build)
- Drama-3-Japanese Q4_K/Q5_K: **Vulkan only** (`GGML_VK_DISABLE_F16/COOPMAT/COOPMAT2=1`, set on profiles by default). CUDA is not supported. Plan for about 23.5 GiB of VRAM.
- Keep `.gguf.json` next to the `.gguf` file

The app does not ship any GGUF files. Enter their paths in the model management dialog.

## Development

```sh
npm install                # also installs the pre-commit hook (husky + lint-staged)
npm run tauri dev          # development
npm test                   # vitest
npm run test:rust          # cargo test (mock worker)
npm run lint               # tsc + ESLint
npm run lint:rust          # clippy (-D warnings)
npm run format             # Prettier (format:check to check only)
npm run format:rust        # rustfmt (format:rust:check to check only)
npm run check              # every format check, lint and test above, in one go
npx tauri build --no-bundle
```

There is no CI. Run `npm run check` before you push. The pre-commit hook formats and lints only the staged files (ESLint `--fix`, Prettier, rustfmt); skip it with `git commit --no-verify` when you need to.

`speech.exe` is looked up in this order: the `SPEECHORUS_SPEECH` environment variable, next to the executable (`speech/speech.exe`, `speech.exe`), then `.engine/speech.exe` (for development).

E2E tests against the real engine (only when the environment variables are set):

```sh
VS_SPEECH_EXE=.engine/speech.exe VS_DRAMA_MODEL=E:/models/Drama-35B-A3B-Japanese-v3-Q4_K.gguf VS_IRODORI_MODEL=irodori-tts-mf \
  cargo test --manifest-path src-tauri/Cargo.toml --test real_engine -- --nocapture
```

## Documentation

- [docs/architecture.md](docs/architecture.md): design (the approved plan)
- [docs/engine-protocol.md](docs/engine-protocol.md): speech.cpp worker protocol and measurements (memory, time, known limitations)

## License

The code is MIT. Model weights follow their own licenses: Drama-3 uses the Fish Audio Community License, and Irodori-TTS v4.1 uses MIT.
