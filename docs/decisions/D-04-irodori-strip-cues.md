# D-04 Irodori strips `[..]` cues and `<|speaker:N|>`

- **Status**: Accepted (2026-11-26)
- **Code**: `src-tauri/src/models/irodori.rs`

## Context

A script is often written for Drama-3, whose acting cues are `[驚いて]`-style brackets. Irodori reads brackets aloud as
text, and it has no `<|speaker:N|>`.

## Decision

The Irodori adapter removes bracket cues and speaker tokens before sending, and the UI shows a notice when it did.
The tag palette switches to Irodori's emoji tags when an Irodori model is loaded.

## Consequences

A Drama-3 script can be generated with Irodori without reading the cues aloud, but its acting directions are lost;
use the emoji tags for Irodori.
