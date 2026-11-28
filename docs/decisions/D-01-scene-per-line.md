# D-01 Scenes are generated line by line by default

- **Status**: Accepted (2026-11-26, approved by the user)
- **Code**: `src/features/generate/`, `src-tauri/src/models/drama3.rs`

## Context

The plan had scene mode send several lines in one request with `<|speaker:N|>` and get one WAV. In the engine spike,
a single request with Drama-3-Japanese voiced **only speaker 0**; the other speakers were missing. It was tried with
4 seeds, `voice none` and a 2-speaker cast voice, with and without spaces or newlines (`docs/engine-protocol.md`).

## Decision

Scene mode has two modes:

- **Per line** (default): each line is generated with its own cast voice, and the lines are joined in order.
- **Single request** (`<|speaker:N|>`, as planned): kept as an option, with a warning. Its take belongs to the scene,
  not to the lines.

## Consequences

- Per-line scenes lack the conversational flow of a single request (turn-taking, breaths). The one-WAV result comes
  from the combined export, not from the scene itself.
- Multi-speaker cast voices (`speech voice … --speaker N`) mainly matter for future models until the engine voices
  every speaker. Re-test single-request scenes when speech.cpp or the model changes.
