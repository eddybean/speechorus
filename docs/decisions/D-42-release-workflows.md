# D-42 Releases: a bump PR, then a draft release on merge

- **Status**: Accepted (2026-11-27); CI and required checks added by D-50/D-52, toolchain pin moved to
  `rust-toolchain.toml` by D-53, time limit and cache by D-55
- **Code**: `.github/workflows/bump.yml`, `.github/workflows/release.yml`

## Context

The user wanted versioned releases that work under branch protection on `main`, without a personal token.

## Decision

Neither workflow pushes to `main`.

- `bump.yml` (by hand; input `bump` patch/minor/major, or an explicit `version`): writes the version into
  `package.json`, `package-lock.json`, `tauri.conf.json`, `Cargo.toml` and `Cargo.lock`, commits `Release vX.Y.Z` to
  `release/vX.Y.Z` and opens a PR. It stops if the tag or branch exists, and deletes the branch again if the PR cannot
  be opened.
- `release.yml` runs on a push to `main` that changes the version in `package.json` (merging that PR), or by hand. A
  small job checks that the three version fields agree and that the tag does not exist. Then on Windows: `npm run
  check`, the NSIS build, the annotated tag `vX.Y.Z` on the built commit, a **draft** release with generated notes, the
  installer and `SHA256SUMS.txt` (a `-` suffix makes a pre-release), and the release branch is deleted. Nothing is
  tagged if the checks or the build fail; rerun by hand.

## Alternatives not taken

- Pushing the version commit straight to `main`: needs a token that bypasses branch protection.
- Tagging from the bump workflow: the tag would point at an unreviewed, unbuilt commit.
- Building with `stable` Rust: the first release run got a newer clippy whose new lint failed `-D warnings`; the
  toolchain is pinned (now in `rust-toolchain.toml`).

## Consequences

- "Allow GitHub Actions to create and approve pull requests" must be on. A tag ruleset on `v*` would block the tag
  push.
- Releases are published by hand from the draft. The installer is not code-signed and there is no updater
  ([#55](https://github.com/eddybean/speechorus/issues/55)).
