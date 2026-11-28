# D-51 The library crate is `rlib` only; CI builds without debug info

- **Status**: Accepted (2026-11-28)
- **Code**: `src-tauri/Cargo.toml`, `.github/workflows/ci.yml`

## Context

The Rust CI job took about 5 min. Tauri's template sets `crate-type = ["staticlib", "cdylib", "rlib"]`; the first two
exist for iOS and Android. Each debug build wrote an 868 MB `speechorus_lib.lib` and a DLL, and release builds ran LTO
for all three.

## Decision

- `crate-type = ["rlib"]`. `speechorus.exe` links it (`main.rs` calls `speechorus_lib::run()`).
- In CI, `CARGO_PROFILE_DEV_DEBUG=0` and `CARGO_PROFILE_TEST_DEBUG=0`, and no separate `cargo fetch` step (clippy and
  test pass `--locked`).

## Consequences

- A warm Rust job takes about 1.5 min; local test rebuilds after a `lib.rs` change went from 20 s to 14 s.
- Do not restore the template's crate types unless building for iOS or Android.
