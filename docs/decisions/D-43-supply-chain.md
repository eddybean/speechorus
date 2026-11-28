# D-43 A 7-day release age and approved install scripts for all dependencies

- **Status**: Accepted (2026-11-27); extended by D-53
- **Code**: `.npmrc`, `package.json` (`devEngines`, `allowScripts`), `scripts/cargo-release-age.mjs`, `.husky/`

## Context

The user asked for the newest non-breaking dependencies and for protection against supply-chain attacks: a hijacked
package version (most are found and unpublished within days), install-script malware, or a moved action tag.

## Decision

- **npm** (`.npmrc`, needs npm 11.19+; `devEngines` fails `npm install`/`ci`/`run` on an older npm or Node < 22.12):
  `min-release-age=7`, `strict-allow-scripts=true` (install scripts run only for packages in `allowScripts`, pinned per
  version; none are needed today), `allow-git=none`, `engine-strict=true`.
- **Cargo** has no such setting, so `scripts/cargo-release-age.mjs` checks every crates.io package in `Cargo.lock`
  against the sparse index's `pubtime` (versions from before `pubtime` count as old) and rejects yanked versions.
  `--fix` moves each one back to the newest compatible version that passes. It runs in the pre-commit hook when
  `Cargo.lock` is staged.
- `npm run deps:update` (npm update, cargo update, then the age fix) and `npm run deps:check` (`npm audit signatures`
  and the age check).
- Workflow actions are pinned to commit SHAs with the tag in a comment; Node 24 and npm 11.19.1 in CI.

## Consequences

- An urgent fix younger than 7 days needs `min-release-age-exclude` in `.npmrc` for that install (Cargo:
  `CARGO_MIN_RELEASE_AGE_DAYS=0`), removed again afterwards. A security advisory whose fix is too young is ignored in
  `deny.toml` with a date (D-53).
- A new dependency with an install script needs `npm approve-scripts <pkg>` after reading the script.
- `deps:check` and the Cargo.lock pre-commit check need network access.
