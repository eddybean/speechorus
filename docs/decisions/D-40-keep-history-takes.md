# D-40 Save and prune keep the WAVs the Undo history can bring back

- **Status**: Accepted (2026-11-26)
- **Code**: `src/store/project.ts` (`historyTakeFiles`), `src-tauri/src/project.rs`, `src/lib/ipc.ts`

## Context

Saving pruned the WAV of a deleted take while the deletion could still be undone, so 削除 → 保存 → Undo brought back a
take with no file. D-39 made it worse: an untitled project's work folder is deleted after the first save.

## Decision

On save, the UI collects every take named in the Undo and Redo stacks and passes them as `keep` to `project_save` and
`project_prune`. Save copies them along (Save As, an untitled project's first save) and prune leaves them. Names that
are not a bare file name are ignored.

## Consequences

A deleted take's WAV stays on disk while the history holds it (up to 300 steps, until the project is closed). It goes
at the next save after it leaves the history, or when the project is next opened.
