# D-49 A `.vsproj` and its takes folder are tied by an id, not only by name

- **Status**: Accepted (2026-11-28)
- **Code**: `src-tauri/src/project.rs`, `src-tauri/src/commands.rs`, `src/lib/types.ts`

## Context

The takes folder was found only by name (`foo.vsproj` → `foo.takes`), so renaming the `.vsproj` in Explorer left the
project without audio.

## Decision

- Saving records the folder's name (`takesDir`) and a project `id` in the `.vsproj`, and writes the id into the
  folder's `.speechorus-project` marker.
- Opening looks for `<name>.takes`, then the recorded folder, then a `*.takes` folder beside it whose marker holds the
  id (both renamed).
- The next save renames the folder to `<name>.takes` when no `.vsproj` of the folder's own name is left (renamed, not
  copied) and no job writes into it; otherwise the takes are copied as with Save As.
- A copy (Save As, or a `.vsproj` copied by hand) gets its own id; from then on the folder's marker decides.

## Alternatives not taken

- A bundle folder: Windows has none (unlike macOS packages).
- NTFS alternate data streams: lost on copies to FAT/exFAT, in zips and in cloud sync.
- A single-file container (zip or SQLite): changes the playback path (the asset protocol plays WAV files) and makes
  every save expensive.

## Consequences

Moving the `.vsproj` to another folder without its takes folder still loses the audio; the search covers the same
folder only.
