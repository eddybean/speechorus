# D-46 One playback volume, up to 200%, through Web Audio

- **Status**: Accepted (2026-11-28, placement and range chosen by the user)
- **Code**: `src/lib/player.ts`, `src/app/TopBar.tsx`, `src-tauri/src/settings.rs`

## Context

The user wanted one volume control reachable at once from the main screen, and later more than 100%. All playback goes
through the one `<audio>` element in `player.ts`, but an element's own `volume` stops at 1.

## Decision

- A speaker button (mute) and a 0–200% slider sit beside 連続再生/停止. Wheel steps 5%, double-click resets to 100%.
- The element plays through Web Audio (element → GainNode → speakers, `crossOrigin = "anonymous"`; the asset protocol
  answers with `Access-Control-Allow-Origin`). Up to 100% the slider position is squared for the gain; above it the
  gain rises linearly to 2× (+6 dB).
- Above 100% a limiter (DynamicsCompressor, −1 dBFS, ratio 20) is put in the path so boosted peaks do not clip. At 100%
  and below it is taken out, because its make-up gain would change the level slightly.
- `playbackVolume` (0.0–2.0) and `playbackMuted` are saved in `settings.json`, 400 ms after the slider stops.

## Alternatives not taken

- A speaker popover or a control in the status bar (offered; the user chose beside the transport buttons).

## Consequences

Only what is heard in the app changes; exports keep the take's own level. Without Web Audio the volume tops out at
100% (not the case in WebView2). The control is not reachable while a dialog covers the window.
