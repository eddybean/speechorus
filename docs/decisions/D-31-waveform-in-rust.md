# D-31 Waveforms are computed in Rust, not decoded in the WebView

- **Status**: Accepted (2026-11-26)
- **Code**: `src-tauri/src/audio.rs`, `src-tauri/src/commands.rs` (`wav_peaks`, `wav_trim`), `src/features/voices/`

## Context

The trimmer needs a waveform. The request suggested decoding with Web Audio and drawing on a canvas.

## Decision

`wav_peaks` reads the WAV with hound and returns 640 min/max pairs; the front end only draws them. Trimming
(`wav_trim`) also runs in Rust and writes 16-bit mono, always cutting from the original file.

## Alternatives not taken

- Decoding in the WebView: needs `fetch` of asset URLs, which means widening the CSP (`connect-src`), and holds whole
  audio files in the WebView. It goes against D-00's "the GUI decodes no audio".

## Consequences

No audio library in the front end. A multi-channel reference becomes mono when trimmed (speech voice mixes to mono
anyway).
