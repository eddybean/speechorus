# Decision records

Why Speechorus is built the way it is, where the code alone does not say. Each file records one decision: the
context, what was decided, the alternatives that were turned down and why, and what follows from it. Read the
records for the area you are about to change, so that a constraint or a rejected approach is not undone by accident.

These replace `docs/deviations.md`, which logged every departure from the first plan. The IDs (`D-NN`) are kept,
because code comments and commit messages refer to them. Entries that only described a feature, or that later
records replaced, have no file; they are listed under [Retired](#retired) with where their content went, and git
history (`git log --grep "D-NN"`) still holds them.

## When to write one

Write a record (the next free number, `D-NN-short-slug.md`) when a change:

- works around a limit of the engine, a model, a library or the platform;
- picks one approach over others that were considered (say what they were and why not);
- makes behavior that looks like a bug or an oversight but is on purpose;
- sets a rule later work must keep (a security boundary, a supply-chain policy, a CI requirement).

Do not write one for a plain feature, a bug fix or a dependency bump with nothing to explain: the commit and the PR
cover those. Known gaps and ideas go to [GitHub Issues](https://github.com/eddybean/speechorus/issues), not here.

When a later decision changes an earlier one, edit the old record's status to `Superseded by D-NN` (or note the part
that changed) instead of leaving two records that disagree. Keep each record about the decision as it stands; the
history is in git.

## Format

```markdown
# D-NN Title that states the decision

- **Status**: Accepted (YYYY-MM-DD) | Superseded by D-NN | Partly superseded by D-NN (what)
- **Code**: the main files

## Context
## Decision
## Alternatives not taken
## Consequences
```

Sections that have nothing to say may be left out. Mention the user only for decisions that were theirs.

## Index

| ID | Decision | Area |
| --- | --- | --- |
| [D-00](D-00-speech-cpp-gui.md) | A GUI over speech.cpp's resident worker; no engine or CLI of our own | engine |
| [D-01](D-01-scene-per-line.md) | Scenes are generated line by line by default | engine, generation |
| [D-03](D-03-irodori-voice-files.md) | Irodori voices are also built into `.voice.gguf` files | voices |
| [D-04](D-04-irodori-strip-cues.md) | Irodori strips `[..]` cues and `<\|speaker:N\|>` | models |
| [D-05](D-05-undo-granularity.md) | Undo merges typing; takes are not part of the history | project |
| [D-06](D-06-global-voice-library.md) | The voice library belongs to the app, not to a project | voices |
| [D-07](D-07-progress-seconds.md) | Progress is shown as seconds generated | generation |
| [D-10](D-10-in-app-speech-download.md) | speech.cpp is downloaded and checked in the app; install.ps1 is not run | engine, security |
| [D-17](D-17-paste-into-line.md) | A multi-piece paste appends its first piece to the current line | script |
| [D-19](D-19-debug-handles.md) | Debug handles for E2E: `window.__speechorus` and `vs-add-refs` | testing |
| [D-22](D-22-bundled-catalog.md) | The model catalog is bundled, never fetched | models, security |
| [D-25](D-25-download-behavior.md) | How model downloads resume, verify, recommend and ask for consent | models |
| [D-28](D-28-dev-engine-search.md) | `.engine/speech.exe` is searched in debug builds only | engine |
| [D-29](D-29-play-pause.md) | Play buttons pause and resume | playback |
| [D-31](D-31-waveform-in-rust.md) | Waveforms are computed in Rust, not decoded in the WebView | audio |
| [D-34](D-34-design-candidate-asr.md) | Voice-design candidates are checked by ASR before fixing | voices |
| [D-36](D-36-rename-speechorus.md) | The app is Speechorus; what kept the old name | product |
| [D-37](D-37-ui-design.md) | Mineral Sage colors, a left rail and a slim top bar | UI |
| [D-39](D-39-work-folder.md) | Scratch audio lives in a per-instance work folder | project, files |
| [D-40](D-40-keep-history-takes.md) | Save and prune keep the WAVs the Undo history can bring back | project, files |
| [D-41](D-41-undo-keeps-new-takes.md) | Undo/Redo keeps takes that arrived after the step | project |
| [D-42](D-42-release-workflows.md) | Releases: a bump PR, then a draft release on merge | CI, release |
| [D-43](D-43-supply-chain.md) | A 7-day release age and approved install scripts for all dependencies | supply chain |
| [D-45](D-45-oxc-toolchain.md) | Oxlint and Oxfmt instead of ESLint and Prettier, for TypeScript 7 | tooling |
| [D-46](D-46-playback-volume.md) | One playback volume, up to 200%, through Web Audio | playback |
| [D-47](D-47-recent-files.md) | Recent files, and the UI copies only `recentProjects` from the core | settings |
| [D-48](D-48-context-menu.md) | The app's own right-click menu; no text selection outside fields | UI |
| [D-49](D-49-rename-safe-project.md) | A `.vsproj` and its takes folder are tied by an id, not only by name | project, files |
| [D-50](D-50-ci.md) | CI on every PR and push to `main` | CI |
| [D-51](D-51-rlib-only.md) | The library crate is `rlib` only; CI builds without debug info | CI, build |
| [D-52](D-52-required-checks.md) | CI is required to merge into `main` | CI |
| [D-53](D-53-supply-chain-checks.md) | cargo-deny, zizmor, Dependabot and a pinned toolchain | supply chain, CI |
| [D-54](D-54-screens-not-dialogs.md) | ボイス and モデル are screens of the main pane, not dialogs | UI |
| [D-55](D-55-release-timeout-cache.md) | The release job has a time limit and reuses the CI cache | release |
| [D-56](D-56-react-19-ureq-3.md) | React 19 and ureq 3, and what each needed | dependencies |
| [D-58](D-58-memory-guard.md) | A free-memory check before the engine starts | engine |
| [D-59](D-59-explicit-downloads.md) | Models are resolved from `speech models`; only the catalog downloads | engine, models |
| [D-60](D-60-bump-app-token.md) | The release PR is opened with a GitHub App token, not `GITHUB_TOKEN` | CI, release |
| [D-61](D-61-file-format-versions.md) | Saved files carry a format version; unreadable or newer app files are set aside | project, settings, voices |

Next free ID: D-62.

## Retired

These have no file. Their content is in git history, and where something still matters it moved as noted.

| ID | Was | Now |
| --- | --- | --- |
| D-02 | Catalog names resolved with `speech pull` | Superseded by [D-59](D-59-explicit-downloads.md), which keeps the reason |
| D-08 | `tsc` + clippy, no ESLint | Superseded by [D-45](D-45-oxc-toolchain.md) |
| D-09 | A scene's single-request take belongs to the scene | Data model; see `Scene` in `src/lib/types.ts` |
| D-11, D-12, D-13 | Queue ETA, copying lines, manual multi-speaker voices | Implemented features |
| D-14, D-15, D-16 | Presets, i18n, multi-line drag | Issues [#43](https://github.com/eddybean/speechorus/issues/43), [#44](https://github.com/eddybean/speechorus/issues/44), [#45](https://github.com/eddybean/speechorus/issues/45) |
| D-18 | Installer verification log | Verification record only |
| D-20 | HTTP client and zip in the GUI binary | Part of [D-10](D-10-in-app-speech-download.md) |
| D-21 | `voice_combine` takes a name | Feature |
| D-23 | Irodori and ASR fetched with `speech pull` | Part of [D-59](D-59-explicit-downloads.md) |
| D-24, D-26 | Recommended quantization; per-download license consent | Part of [D-25](D-25-download-behavior.md) |
| D-27 | Uninstalling keeps user data | Tauri default; the unverified part is issue [#56](https://github.com/eddybean/speechorus/issues/56) |
| D-30 | Gear icon for settings | Superseded by [D-37](D-37-ui-design.md) |
| D-32, D-33 | Trimming details; prompt-only voices | Features (`src/features/voices/`) |
| D-35 | `vs-add-refs` debug event | Part of [D-19](D-19-debug-handles.md) |
| D-38 | Copy and paste a take's seed | Feature |
| D-44 | Vitest 4 for advisories | Superseded by [D-45](D-45-oxc-toolchain.md) |
| D-57 | Esc closes 書き出し; per-profile env fields | Bug fixes, covered by `Dialog.test.tsx` and `ModelManager.test.tsx` |
