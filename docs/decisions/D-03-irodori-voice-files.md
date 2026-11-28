# D-03 Irodori voices are also built into `.voice.gguf` files

- **Status**: Accepted (2026-11-26)
- **Code**: `src-tauri/src/voices.rs`, `src/features/voices/`

## Context

Irodori-TTS can take a reference WAV directly, with no transcript. Drama-3 needs a `.voice.gguf` made by
`speech voice` from a reference and its transcript.

## Decision

Irodori voices are always made into a file first (`speech voice irodori-tts-mf ref.wav`), the same as Drama-3.

## Alternatives not taken

- Passing the WAV per request for Irodori: two ways of managing voices and of registering them with the worker, and
  the reference would be encoded on every request.

## Consequences

- One voice library and one registration path for every model; encoding happens once (about 1 s per voice).
- Voices are not portable between models: a Drama-3 voice cannot be used with Irodori, or the other way round. The UI
  warns when a cast's voice does not match the loaded model.
