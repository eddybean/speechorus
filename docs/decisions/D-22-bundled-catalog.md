# D-22 The model catalog is bundled, never fetched

- **Status**: Accepted (2026-11-26)
- **Code**: `assets/models/catalog.json`, `src-tauri/src/downloads.rs`

## Context

The download dialog needs a list of models with their URLs, sizes and SHA-256 sums.

## Decision

`assets/models/catalog.json` is built into the app. A `catalog.json` in the app config dir replaces it when present.
The app never downloads a catalog. For `speechPull` models the variants come from the local `speech models --json`
(D-59).

## Alternatives not taken

- A remote catalog: another trust boundary, since whoever serves it chooses what the app downloads and which hashes it
  trusts.

## Consequences

Catalog changes reach users with an app update, or by placing the override file by hand.
