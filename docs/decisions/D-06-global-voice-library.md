# D-06 The voice library belongs to the app, not to a project

- **Status**: Accepted (2026-11-26)
- **Code**: `src-tauri/src/voices.rs`

## Context

The plan did not say where voices live. A voice takes effort to make (reference, transcript, trimming, design), and
the same voice is wanted across projects.

## Decision

Voices (`.voice.gguf`, with their reference WAVs copied in) live in the app data dir under `voices/`. A project refers
to a voice only by its ID.

## Consequences

Moving a `.vsproj` to another PC does not bring its voices; its casts show the voice as unavailable. An export or
import of voices with a project would be a separate feature.
