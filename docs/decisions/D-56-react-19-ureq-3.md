# D-56 React 19 and ureq 3, and what each needed

- **Status**: Accepted (2026-11-28)
- **Code**: `package.json`, `.github/dependabot.yml`, `src-tauri/src/downloads.rs`, `src-tauri/src/installer.rs`

## Context

D-45 had left React 18.3 (the bundle grows, no security gain, the Tauri flows untested) and ureq 2 (API rewrite, no
advisory). Dependabot then opened the majors.

## Decision

- **React 19** (`react`, `react-dom`, `@types/react`, `@types/react-dom`). Dependabot opened react and react-dom as two
  PRs, and each fails `npm ci` alone on the peer range, so they were taken in one change; `dependabot.yml` now groups
  the four, all update types included. No source change was needed. The bundle grows by about 79 kB (+23 kB gzip).
- **ureq 3**: `timeout_read` became `timeout_per_read`, which restarts on each read, so a stalled download fails after
  60 s and a slow one is not cut. ureq 3 fails to gunzip a 206 the server sent gzip-encoded (ureq 2 passed the bytes
  through), so resumable downloads ask for `Accept-Encoding: identity`; the size and SHA-256 checks are on the file's
  own bytes anyway.

## Consequences

Keep `Accept-Encoding: identity` on range requests. React upgrades come as one grouped PR.
