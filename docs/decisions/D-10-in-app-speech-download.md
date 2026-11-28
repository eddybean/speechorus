# D-10 speech.cpp is downloaded and checked in the app; install.ps1 is not run

- **Status**: Accepted (2026-11-26, the user chose option c)
- **Code**: `src-tauri/src/installer.rs`

## Context

The plan asked for a button that installs speech.cpp. The official procedure, `irm …/install.ps1 | iex`, runs a remote
script as is.

## Decision

The "speech.cpp をダウンロード" button (model management and Settings) gets the latest release through the GitHub API,
checks the zip against the release's `SHA256SUMS`, and extracts it into
`%LOCALAPPDATA%\dev.speechorus.app\speech\<tag>\`, refusing entries whose path would leave that folder. The settings
and every profile whose speech.exe is missing then point at it.

## Alternatives not taken

- (a) Run install.ps1 after a confirmation: executes a remote script with the user's rights.
- (b) Open the release page in the browser: leaves the user to unpack and point at the file.

## Consequences

- The GUI binary depends on an HTTP client (`ureq`, rustls), `zip` (deflate only) and `sha2`; the release exe grew to
  about 5 MB. The code runs only during a download.
- speech.exe is not put on PATH (install.ps1 would).
- Extraction writes regular files itself and checks `enclosed_name()`; keep it that way when updating `zip` (see the
  `extracts_and_refuses_zip_slip` test).
