# D-28 `.engine/speech.exe` is searched in debug builds only

- **Status**: Accepted (2026-11-26)
- **Code**: `src-tauri/src/tools.rs`

## Context

For development, speech.exe is looked up in the repository's `.engine/` folder. In the installer test, an installed
release build picked up the repository's `.engine\speech.exe` on its first run because the working folder happened to
be the repository.

## Decision

The lookup order is `SPEECHORUS_SPEECH`, next to the app exe (`speech/speech.exe`, `speech.exe`), then `.engine/speech.exe`
**in debug builds only**.

## Consequences

An installed app's first run has no speech.exe until the user downloads it (D-10) or enters its path.
