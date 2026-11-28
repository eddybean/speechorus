# D-58 A free-memory check before the engine starts

- **Status**: Accepted (2026-11-28)
- **Code**: `src-tauri/src/memguard.rs`, `src-tauri/src/commands.rs` (`engine_start`), `src/store/app.ts`,
  `src-tauri/src/settings.rs` (`memoryGuard`)

## Context

Loading a model over VRAM another program is using can push Windows into paging VRAM and freeze the PC. The user
wanted that prevented without refusing loads that would fit.

## Decision

- Before `engine_start` stops the running worker, it checks that the model fits the free memory of the device it
  loads on, from `speech devices --json` (0.15 s) with the profile's speech.exe. The device is the profile's (`auto`:
  the first GPU, else the CPU), so a CPU profile is checked against main memory.
- The need is estimated from the file size: file × 1.1 + 512 MiB (Drama-3 Q4_K: 20.8 GiB → 23.4 GiB, measured about
  23.5 GiB). What the running engine holds on that device counts as free, since it stops first; that is measured after
  each start as free before minus after (the estimate until then).
- 設定 → システム保護: オフ (no check); 弱 (asks when the file alone exceeds free memory); 標準, the default (asks when the
  estimate does); 強 (refuses unless estimate + 1.5 GiB is free). An unknown value reads as 標準.
- `engine_start` returns `{status: "started" | "confirm" | "blocked", check}`; on a yes the UI calls again with
  `confirmed`. 強 is `blocked` whatever `confirmed` says. The モデル screen's VRAM estimate uses the same formula.

## Alternatives not taken

- Always refusing when the estimate does not fit: Drama-3 with `experts_on_cpu` can run by computing some experts on
  the CPU, so a refusal would block working setups.

## Consequences

- The estimate ignores context length and other options.
- The check is skipped (and the engine starts) when `speech devices` fails, the device is not listed, or the model
  file cannot be read. Memory taken after the check is not seen.
