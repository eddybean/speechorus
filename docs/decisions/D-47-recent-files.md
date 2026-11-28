# D-47 Recent files, and the UI copies only `recentProjects` from the core

- **Status**: Accepted (2026-11-28)
- **Code**: `src/app/Menu.tsx` (`SubMenu`), `src/features/project/fileOps.ts`, `src-tauri/src/settings.rs`

## Context

The core already kept `recentProjects` in `settings.json` (`push_recent_project` on load and save), but no UI showed
it. Both the core and the UI write settings: the UI writes the whole settings object back (volume, theme, tags).

## Decision

- ファイル → 最近使ったファイル is a submenu: the last 10 projects, newest first, 1–9 as keys, 一覧をクリア at the end.
  A file that cannot be opened is removed from the list and the error shown.
- After open and save, the UI copies **only** `recentProjects` from the core's settings into its own.

## Alternatives not taken

- Replacing the UI's whole settings with the core's after open (the old behavior): drops a volume change not yet
  written (D-46).
- Not copying anything: the UI's next settings write puts the old list back.

## Consequences

Any other setting that the core changes on its own needs the same field-by-field copy. Paths are compared as typed,
so one file reached by two spellings shows twice.
