# D-36 The app is Speechorus; what kept the old name

- **Status**: Accepted (2026-11-26, user decision)

## Context

The working name "Voice Studio" clashed with existing software. Speechorus (Speech + Chorus) turned up no similar
product in a web search; trademark databases were not checked.

## Decision

Renamed: `productName`, the window title and UI strings; the bundle identifier `dev.speechorus.app` (so the data
folders are `%APPDATA%\dev.speechorus.app\` and `%LOCALAPPDATA%\dev.speechorus.app\`); the install folder
`%LOCALAPPDATA%\Speechorus`; the Cargo package `speechorus` (lib `speechorus_lib`) and the npm package; the
User-Agents `speechorus-downloader` / `speechorus-installer`; `window.__speechorus`; the env var `SPEECHORUS_SPEECH`.

Kept on purpose (user decision): the `.vsproj` extension, the `vs-add-refs` event, the repository folder
`voice-studio`. Not done: no migration of data from the old folders, and the old env var `VOICE_STUDIO_SPEECH` is not
read.

## Consequences

Changing the bundle identifier again would move every user's settings, voices and models; avoid it.
