# D-41 Undo/Redo keeps takes that arrived after the step

- **Status**: Accepted (2026-11-26)
- **Code**: `src/store/project.ts` (`keepUnknownTakes`), `src/store/project.test.ts`

## Context

immer records `takes = takes.filter(...)` and `lines = lines.filter(...)` as replacing the whole array, and takes are
not part of the history (D-05). So undoing テイクを削除 or 行を削除 put back the old array, and takes generated after
that step vanished from the project; their WAVs were then pruned at save.

## Decision

After an Undo or Redo, any take that was on a line or scene before, is gone after, and does not appear in that step's
patches is put back at the end of the takes. If the step left the selection on a take that no longer exists, the
previous selection is kept.

## Consequences

A take the step itself removed or restored still follows Undo/Redo. Any new history operation that replaces an array
holding takes has to go through the same path.
