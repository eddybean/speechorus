# D-05 Undo merges typing; takes are not part of the history

- **Status**: Accepted (2026-11-26); extended by D-40 and D-41
- **Code**: `src/store/project.ts`

## Context

The project store keeps an immer patch history. Undoing one character at a time is impractical, and undoing a
generation result would leave the project and the WAV files on disk out of step.

## Decision

- Typing on the same line within `MERGE_MS` (1.2 s) is one Undo step.
- Takes arriving from the engine are not recorded in the history.

## Consequences

- Undo cannot remove a generated take; the user deletes the take instead.
- A deleted take can be brought back by Undo, so its WAV must survive saves while the history holds it (D-40), and
  an Undo must not drop takes that arrived after the step (D-41).
