# D-39 Scratch audio lives in a per-instance work folder

- **Status**: Accepted (2026-11-26)
- **Code**: `src-tauri/src/work.rs`, `src-tauri/src/commands.rs`, `src/features/project/fileOps.ts`

## Context

Untitled projects' takes, voice-design candidates and trimmed references were never removed, and design candidates
sat in `<takes>/design/`, which prune never looked into.

## Decision

- Each running app gets `work/<uuid>/` in the local app data dir and holds its `.lock` open without sharing. At start,
  every other folder under `work/` that no running instance holds is removed, so a crash leaves nothing behind and a
  second instance is left alone.
- An untitled project's takes go there. Its folder is deleted once the project is saved elsewhere, or when the UI
  leaves it for 新規 / 開く (`project_release`), unless a job still writes into it (the next start sweeps it then).
- Design candidates go to `work/<uuid>/design/` (「候補をクリア」 deletes them); trimmed references to
  `work/<uuid>/trimmed/`, deleted when re-cut, reset, removed, or copied into `voices/refs/` by 「作成」.
- Opening a project prunes its takes folder too, not only saving. Prune skips the WAV the running job is writing.

## Consequences

- An untitled project's takes are gone once it is discarded, and unsaved takes of a saved project are removed the
  next time it is opened.
- Anything new that writes scratch audio should go under the work folder, not beside the project or in the voice
  library.
