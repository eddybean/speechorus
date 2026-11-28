# D-59 Models are resolved from `speech models`; only the catalog downloads

- **Status**: Accepted (2026-11-28); replaces D-02 and the download part of D-23
- **Code**: `src-tauri/src/tools.rs` (`resolve_model`), `src-tauri/src/downloads.rs` (`Catalog::merge_speech`),
  `src/features/models/`, `src/app/StatusBar.tsx`, `src/store/app.ts`

## Context

- Passing a catalog name (`irodori-tts-mf`, `qwen3-asr-0.6b`) to speech.exe started from another program sometimes
  re-fetched a model that was already there (`docs/engine-protocol.md`). So names were resolved to paths once, first
  with `speech pull NAME` (D-02).
- That made the engine start download silently: picking Irodori-TTS Large on the モデル screen only set its name, and
  the download then ran inside the start with no progress, no cancel and the engine shown as stopped. It looked frozen.
  Large was not in the catalog dialog at all.

## Decision

- `resolve_model` looks the name (`NAME` or `NAME:TYPE`; TYPE defaults to the model's own) up in
  `speech models --json` (40 ms) and returns the file's path when fetched. Otherwise it fails with a message pointing
  to the catalog. This covers the engine start, モデルを確認 and ASR. Every subcommand gets a path, never a name.
- The catalog dialog is the one place that downloads. For `speechPull` models (the Irodori family, Qwen3-ASR) the
  variants come from `speech models --json`: each quantization, its real size, a VRAM estimate (D-58) and ✓ 取得済.
  The download runs `speech pull NAME:TYPE` into speech.cpp's own model folder, with progress (parsed from its
  stderr), cancel and the free-space check.
- The モデル screen offers only fetched Irodori files, and a profile naming an unfetched model shows a warning with a
  button to the catalog and a disabled start.
- The status bar shows the running download from any screen. `engineStarting` covers the time from the click until
  `engine_start` returns, so a second start is ignored and the buttons say 準備中….

## Alternatives not taken

- Keeping `speech pull` in the start path with a progress display: the engine start would still be a hidden download,
  and a profile could trigger tens of GB without the user choosing it.

## Consequences

- Picking or starting a model never downloads. A fresh install's Irodori profile needs a download first.
- Other speech.cpp models (Qwen3-TTS and so on) are not offered, as no adapter uses them. A typed name speech.cpp does
  not list fails with its own message.
- For `speech pull` downloads the destination cannot be chosen.
