# D-50 CI on every PR and push to `main`

- **Status**: Accepted (2026-11-28); required by D-52, third job added by D-53
- **Code**: `.github/workflows/ci.yml`

## Context

While the repository was private, CI was left out to save Actions minutes (D-42). Once it was public, standard
GitHub-hosted runners cost nothing.

## Decision

`ci.yml` runs on every PR into `main`, every push to `main` and by hand, in parallel jobs that together cover
`npm run check`:

- `Frontend` (ubuntu): `npm ci`, `deps:check`, `format:check`, `lint`, `test`.
- `Rust` (windows, the platform the app targets): `cargo fmt --check`, clippy `--all-targets -D warnings` and
  `cargo test` with `--locked`, using the mock worker; `tests/real_engine.rs` skips itself.
- Read-only token, SHA-pinned actions, and a new push cancels the run for the old head.

## Consequences

When a check is added to `npm run check`, add it to `ci.yml` too. Renaming a job means updating the ruleset (D-52).
The installer is built only by `release.yml`.
