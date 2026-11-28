# D-53 cargo-deny, zizmor, Dependabot and a pinned toolchain

- **Status**: Accepted (2026-11-28)
- **Code**: `rust-toolchain.toml`, `src-tauri/deny.toml`, `.github/dependabot.yml`, `.github/workflows/*.yml`

## Context

The user asked for the de-facto supply-chain tools of the stack, free ones only, in place of tracking advisories by
hand and running `deps:update` as the only way to see updates.

## Decision

- **`rust-toolchain.toml`**: Rust 1.93.1 with clippy and rustfmt, `profile = "minimal"`, used by local builds, CI and
  releases alike, so a new stable's clippy cannot break CI or a release. Raise it on purpose.
- **cargo-deny** (`npm run deps:deny`, `deny.toml`): RustSec advisories (yanked versions fail), licenses, bans and
  sources, for `x86_64-pc-windows-msvc` only. Allowed licenses: Apache-2.0, BSD-3-Clause, CDLA-Permissive-2.0, ISC,
  MIT, MPL-2.0, Unicode-3.0, Zlib. Only crates.io as a source. `publish = false` in `Cargo.toml` keeps the app's own
  PolyForm license out of the check. An ignored advisory needs a reason and is dropped once its fix is old enough
  (D-43).
- **zizmor** (`npm run lint:actions`, via `uvx`): its findings were fixed (`persist-credentials: false` where nothing
  is pushed, per-job permissions, `${{ }}` moved out of `run:` into `env:`). Suppressions are inline with a reason.
- **CI**: a third job, `Supply chain (cargo-deny, zizmor)`, installs cargo-deny 0.21 from its release against a pinned
  SHA-256 (0.22 needs Rust 1.95 to build locally).
- **Dependabot**: weekly npm, Cargo and Actions updates with `cooldown: 7 days` to match the release-age window, minor
  and patch grouped per ecosystem, Oxfmt alone (D-45), React packages together (D-56).
- **GitHub settings**: Dependabot alerts and security updates, CodeQL default setup for `actions` and
  `javascript-typescript` (Rust left out: slow), secret scanning with push protection.

## Consequences

- `deps:deny` and `lint:actions` are not in `npm run check` (they need cargo-deny and uv); CI runs them.
- A new RustSec advisory fails the job on unrelated PRs until it is fixed or ignored.
- A Dependabot PR can pull a too-young transitive version into a lock file; `deps:check` fails it. Security updates
  skip the cooldown.
- Dependabot updates only the SHA, not the `# vX.Y.Z` comment, when another comment follows on the line
  (`# zizmor: ignore[...]`); fix the comment by hand in such PRs.
