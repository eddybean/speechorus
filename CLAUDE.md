# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Speechorus (repo folder `voice-studio`; renamed in D-36) is a Windows desktop Japanese TTS studio: Tauri 2 + React 18 + TypeScript on the front, Rust core behind it, and the external [speech.cpp](https://github.com/nyosegawa/speech.cpp) `speech.exe` (v0.11.2+, Vulkan build) as the engine. Main model: Drama-3-Japanese (Q4_K/Q5_K, Vulkan only, needs `GGML_VK_DISABLE_F16/COOPMAT/COOPMAT2=1`, and its `.gguf.json` sidecar next to the GGUF). Second model: Irodori-TTS. The app ships no GGUF files. The UI text is Japanese.

## Commands

```sh
npm install                  # also sets up the husky pre-commit hook (lint-staged)
npm run tauri dev            # run the app (Vite on port 1420, strictPort)
npm test                     # vitest (jsdom, globals)
npx vitest run src/lib/text.test.ts        # one test file
npx vitest run -t "test name"              # by test name
npm run typecheck            # tsc -b --noEmit
npm run lint                 # typecheck + Oxlint
npm run format               # Oxfmt (format:check to check)
npm run test:rust            # cargo test, using the mock worker
cargo test --manifest-path src-tauri/Cargo.toml <test_name>   # one Rust test
npm run lint:rust            # clippy, all targets, -D warnings
npm run format:rust          # cargo fmt (format:rust:check to check)
npm run check                # all format checks, lints and tests
npm run deps:update          # npm update + cargo update, then pull crates younger than 7 days back
npm run deps:check           # npm audit signatures + crate release-age check
npx tauri build --no-bundle
```

Tooling: Oxfmt (`.oxfmtrc.json`: `printWidth` 120, trailing commas, Prettier-compatible output, ignore list in `ignorePatterns`; Markdown is not formatted; D-45), Oxlint (`.oxlintrc.json`: the correctness category, the typescript-eslint recommended rules, and the classic react-hooks rules, not the React Compiler ones; ESLint was dropped so that TypeScript 7 can be used, D-45), rustfmt (`src-tauri/rustfmt.toml`: `max_width` 120). The pre-commit hook runs Oxlint `--fix`, Oxfmt and rustfmt on staged files, and the crate release-age check when `Cargo.lock` is staged.

Supply chain (D-43): `.npmrc` sets `min-release-age=7`, `strict-allow-scripts` (approve a new install script with `npm approve-scripts <pkg>` after reading it) and `allow-git=none`; it needs npm 11.19+, which `devEngines` enforces. Cargo has no such setting, so `scripts/cargo-release-age.mjs` checks `Cargo.lock` against the index `pubtime` (`--fix` moves crates back). Workflow actions are pinned to commit SHAs (tag in a comment).

CI (D-50, since the repo went public): `.github/workflows/ci.yml` runs on every PR into `main` and every push to `main`, in two parallel jobs: `Frontend` (ubuntu: `deps:check`, `format:check`, `lint`, `test`) and `Rust` (windows: `cargo fmt --check`, clippy and `cargo test` with `--locked`, no debug info; D-51). Together they cover `npm run check`; still run it before pushing. The `main` ruleset "Require CI" makes both jobs required for merging (D-52); renaming a job in `ci.yml` means updating the ruleset too. If you add a check to `npm run check`, add it to `ci.yml` too. The release workflows (D-42) push nothing to `main`:
- `.github/workflows/bump.yml`, run by hand (`gh workflow run bump.yml -f bump=patch`, or `-f version=0.2.0`): writes the new version into `package.json`/`package-lock.json`, `tauri.conf.json` and `Cargo.toml`/`Cargo.lock` on a `release/vX.Y.Z` branch and opens a PR. It then starts `ci.yml` on that branch by `workflow_dispatch`, since a PR opened with `GITHUB_TOKEN` triggers no workflows.
- `.github/workflows/release.yml`, run when a push to `main` changes the version in `package.json` (merging that PR), or by hand to release the current version: runs `npm run check`, builds the NSIS installer, pushes the `vX.Y.Z` tag and creates a draft release with the installer and `SHA256SUMS.txt`. A version with a `-` suffix becomes a pre-release.

E2E against the real engine (`src-tauri/tests/real_engine.rs`; each section is skipped when its env var is not set):

```sh
VS_SPEECH_EXE=.engine/speech.exe VS_DRAMA_MODEL=path/to/Drama-35B-A3B-Japanese-v3-Q4_K.gguf VS_IRODORI_MODEL=irodori-tts-mf \
  cargo test --manifest-path src-tauri/Cargo.toml --test real_engine -- --nocapture --test-threads=1
```

`speech.exe` is looked up in this order: `SPEECHORUS_SPEECH`, next to the app exe (`speech/speech.exe`, `speech.exe`), then `.engine/speech.exe` (debug builds only). `.engine/` is gitignored.

## Architecture

**Engine process.** `engine::EngineSupervisor` keeps one resident `speech worker <model>` child process and talks JSON Lines over stdin/stdout (protocol 4; stdout carries only the protocol, logs go to stderr). It handles `synthesize` (streams base64 PCM `chunk`s), `add_voice`, `count_tokens`, `info` and `cancel`. Switching models stops one worker and starts the next. `speech voice`, `speech asr` and `speech pull` run as short-lived processes. Model catalog names (e.g. `irodori-tts-mf`) are resolved to file paths with `speech pull` before use (D-02). The protocol details and measurements are in `docs/engine-protocol.md`: read it before touching `engine/` or the adapters.

**Model adapters** (`src-tauri/src/models/`). Each model declares `Capabilities` (tag syntax brackets/emoji, sample rate, multi-speaker support, and so on) and an `OptionSpec` schema, and turns a `LineRequest` into a worker request. The worker rejects any member it does not know (`invalid_argument`), so an adapter must send only options its model takes. The UI builds its option forms from the schema (`features/models/OptionForm.tsx`). Irodori strips `[..]` cues and `<|speaker:N|>` before sending (D-04). The tag palettes are `assets/tags/*.json`; the download catalog is `assets/models/catalog.json`.

**Jobs.** `jobs::GenerationQueue` runs one job at a time on the worker and writes each take to a WAV in the project's takes folder. `jobs::mock` is a fake worker used by the Rust unit tests.

**Core → UI.** All events go over one Tauri channel, `vs://event`, as `AppEvent` (`Engine`, `EngineLog`, `Queue`, `Download`), tagged `{kind, data}`. Commands are registered in `lib.rs` and defined in `commands.rs`, and `src/lib/ipc.ts` holds typed wrappers for them. When you add or change a command, update all three, plus `src/lib/types.ts`, which mirrors the Rust structs. Rust structs serialize as camelCase (`#[serde(rename_all = "camelCase")]`); keep it that way.

**Frontend state.** It uses zustand.
- `src/store/project.ts` holds the project (cast, lines, takes) with an immer patch Undo/Redo history. Typing on the same line within `MERGE_MS` (1.2 s) is one Undo step. Takes arriving from the engine are not part of the history (D-05).
- `src/store/app.ts` holds settings, the engine state, the queue, notices and the chosen profile.
- `src/features/*` holds the UI by feature (script, tags, voices, takes, models, export, generate, settings, cast).
- Playback is an HTML `<audio>` element pointed at WAV files through the asset protocol (`src/lib/player.ts`); the GUI decodes no audio itself. Waveform peaks and trimming are computed in Rust (`wav_peaks`, `wav_trim`).

**Persistence.**
- A project is a `.vsproj` JSON file plus a `<project>.takes/` folder of WAVs. The `.vsproj` records the folder name (`takesDir`) and an `id` that the folder's `.speechorus-project` marker repeats, so a hand-renamed `.vsproj` still finds its takes and the next save renames the folder (D-49). `project_prune` removes WAVs that are no longer referenced.
- App settings (model profiles: adapter, GGUF, speech.exe, device, env; the playback volume, D-46) are stored in the app config dir as `settings.json`. A `catalog.json` there overrides the bundled catalog.
- The voice library (`.voice.gguf` files) lives in the app data dir under `voices/`.
- Scratch audio lives in `work/<uuid>/` in the local app data dir, one per running instance and locked by its `.lock` (`work.rs`, D-39): untitled projects' takes, `design/` candidates and `trimmed/` references. At start, folders that no running instance holds are swept.

**Debug handles.** For E2E driven over DevTools, `window.__speechorus` exposes the stores and actions (D-19), and the window event `vs-add-refs` adds reference audio by path (D-35).

## Project process

- `docs/architecture.md` is the approved plan. Every departure from it is recorded in `docs/deviations.md` as a `D-NN` entry (what / why / workaround / user impact, plus a status tag). Confirm large changes that affect a requirement with the user before making them, and add a D-entry for any deviation. Commit messages refer to these IDs (e.g. "(D-37)").
- Known engine limitation: a single-request `<|speaker:N|>` scene with Drama-3-Japanese voices only speaker 0, so per-line scene mode is the default (D-01).
