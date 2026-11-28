# D-55 The release job has a time limit and reuses the CI cache

- **Status**: Accepted (2026-11-28)
- **Code**: `.github/workflows/release.yml`, `.github/workflows/ci.yml`

## Context

The first release after D-53 (v0.1.6) sat in `npm run check` for 40 min until it was force-cancelled; a plain cancel
did not reach the runner and no log was uploaded. `rust-toolchain.toml` had changed the rust-cache key, so that run
built every crate from scratch with debug info, which CI does not do (D-51). Why the runner stopped responding is not
known.

## Decision

- `timeout-minutes: 45` on the `release` job (a release takes about 10 min; the default limit is 6 h).
- `CARGO_PROFILE_DEV_DEBUG=0` and `CARGO_PROFILE_TEST_DEBUG=0`, as in the Rust CI job (the installer uses the release
  profile, which they do not touch).
- Both jobs use rust-cache `shared-key: windows-nodebug`; the release job restores but does not save
  (`save-if: false`), so its release-profile build does not bloat the cache.

## Consequences

Changing the toolchain or the cache key means the next release builds cold unless a CI run on `main` has saved the new
cache first.
