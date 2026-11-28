# D-61 Saved files carry a format version; unreadable or newer app files are set aside, never overwritten

- **Status**: Accepted (2026-11-28)
- **Code**: `src-tauri/src/stored.rs`, `src-tauri/src/settings.rs` (`SETTINGS_VERSION`, `migrate`),
  `src-tauri/src/voices.rs` (`VOICES_VERSION`, `migrate`), `src-tauri/src/project.rs` (`PROJECT_VERSION`, `migrate`),
  `src-tauri/src/lib.rs`, `commands.rs` (`take_startup_notices`), `src/store/app.ts`

## Context

`.vsproj` already had a `version`, refused a newer project and kept members it did not know (`extra`). The app's own
files did not:

- `settings.json` had a `version` that nothing read. When it failed to parse (a damaged file, or a future change of
  a member's type), the app started with first-run settings and saved them over it, so the user's profiles were lost
  without a word. Members a newer version had added were dropped by the next save.
- `voices.json` was a bare list with no version. When it failed to parse, the library opened empty and the next new
  voice overwrote the list; the `.voice.gguf` files stayed, but their names and references were lost.

So a breaking change to either file, or a newer build followed by an older one, could destroy user data.

## Decision

- `.vsproj`, `settings.json` and `voices.json` each have a format version (`PROJECT_VERSION`, `SETTINGS_VERSION`,
  `VOICES_VERSION`, all 1) and a `migrate(value, from)` that upgrades the JSON one version at a time on load. Raise
  the version, with a step, only when a change would read an older file wrongly (a member renamed, moved or given
  another meaning); adding a member with a serde default needs neither.
- `voices.json` becomes `{"version": 1, "voices": [...]}`. The old bare list reads as version 0 and is upgraded.
- All three keep members they do not know (`#[serde(flatten)] extra`, also on each `Voice`), so an older build saving
  a newer file does not drop them.
- `settings.json` and `voices.json` (`stored::load`):
  - Unreadable (not JSON, wrong shape, a failed migration, or a read error): the file is renamed to
    `<name>.broken-<unix seconds>` and the app goes on with the defaults.
  - Newer than this build: it is copied to `<name>.v<N>-<unix seconds>` (once; later starts reuse the copy) and read
    as far as this build understands it. The next save writes this build's version.
  - Either way the user gets a notice at start (`take_startup_notices`, shown as an error notice so it stays up for 12 s)
    with the path of the file set aside.
- A newer `.vsproj` is still refused (`TooNew`): it is the user's document, and opening it read-only is not offered.

## Alternatives not taken

- Refusing to start on an unreadable or newer `settings.json`: the user could then not reach the settings to fix it.
- Keeping the newer version number when an older build saves: a newer build would then skip the migration for data
  the older build wrote in the older shape. Writing this build's version makes the newer build migrate again, and the
  copy keeps the original.
- A version per profile or per voice: one per file is enough while the file is written as a whole.

## Consequences

- A newer build's settings, read by an older build, may lose meaning that was not expressed in members the older
  build knows; the `.v<N>-…` copy is there to restore by hand.
- Backups are not cleaned up; they are small and few (one per incident).
- `catalog.json` (an override in the config folder) is not covered: an unreadable one already falls back to the
  bundled catalog, and nothing writes to it.
