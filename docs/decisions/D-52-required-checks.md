# D-52 CI is required to merge into `main`

- **Status**: Accepted (2026-11-28); partly superseded by D-60 (how the release PR gets the checks)
- **Code**: the repository ruleset "Require CI" (GitHub settings), `.github/workflows/bump.yml`

## Decision

- The active ruleset "Require CI" on the default branch requires the `ci.yml` checks
  `Frontend (format, typecheck, Oxlint, Vitest)` and `Rust (rustfmt, clippy, cargo test)` from GitHub Actions. The
  branch need not be up to date with `main`. Repository admins may bypass it (for a broken CI). The disabled ruleset
  "main" is left as it was.
- The release PR from `bump.yml` must get these checks too. It is opened with a GitHub App token, so it runs
  `ci.yml` like any other PR (D-60).

## Consequences

- A PR cannot be merged until both jobs pass; direct pushes to `main` are refused except by an admin bypass.
- Renaming a job in `ci.yml` breaks the requirement until the ruleset is updated.
- `Supply chain (cargo-deny, zizmor)` (D-53) is not required yet.
