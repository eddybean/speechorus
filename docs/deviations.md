# Deviations from the plan

This file records every place where the implementation differs from the approved plan ([architecture.md](architecture.md)).
Each entry gives **what** changed, **why**, the **workaround or alternative**, and the **impact on the user**.
Status: `変更` = done differently, `未実装` = not done yet, `追加` = not in the plan, `要確認` = the user's decision is pending.

Added during the turn that ended with commit `2ebe65d` (D-01 to D-19). These were recorded after the work was done.
The rule to confirm major changes before making them was introduced after this turn, so these entries were not confirmed in advance.
They are listed under "Decisions pending" at the end.

---

## Changes to the method

### D-01 The default scene mode is "per line"; the single-request `<|speaker:N|>` mode stays as an option 【変更・承認済み 2026-11-26】
- **What**: The plan says scene mode generates several lines in one request with `<|speaker:N|>` and outputs one WAV. The implementation offers two modes: "per line", the default, where each line uses its own cast voice and the lines are joined in order; and "single request" (`<|speaker:N|>`, as in the plan).
- **Why**: In the spike, a single request with Drama-3-Japanese voiced **only speaker 0**, with the second speaker onward missing. It was tested with 4 seeds, `voice none` and a 2-speaker cast voice, with and without spaces or newlines (docs/engine-protocol.md).
- **Workaround**: Single-request mode remains available, with a warning shown. Per-line mode produces a WAV through playback and the combined export.
- **User impact**: Per-line mode does not produce the conversational flow of a single request (turn-taking, breaths and so on). It is not a "one WAV" output in the scene itself: you get it from the combined export.

### D-02 Model catalog names are resolved to file paths with `speech pull` before use 【変更】
- **What**: The profile's `irodori-tts-mf` and the ASR's `qwen3-asr-0.6b` are converted to a path with `speech pull NAME`, and every subcommand receives that path.
- **Why**: When speech.exe was started from another program, passing a model name sometimes downloaded the existing model again.
- **Workaround / user impact**: None. On first use of a model that has not been fetched yet, the download runs (the model management dialog shows "not fetched").

### D-03 Irodori voices are also always turned into a `.voice.gguf` 【変更】
- **What**: The plan says Irodori can use a reference WAV directly. The implementation always makes a voice file first with `speech voice irodori-tts-mf ref.wav`.
- **Why**: It keeps voice management the same as Drama-3 (one library, one way of registering with the worker), and loads faster (encoding happens once).
- **User impact**: Creating a voice takes about 1 s. Voices are not portable between models (a Drama-3 voice cannot be used with Irodori, and vice versa; the UI shows a warning).

### D-04 Irodori removes `[..]` cues and `<|speaker:N|>` before sending 【追加】
- **What**: When a line written for Drama-3 is generated with Irodori, bracket cues are removed and a notice is shown.
- **Why**: Irodori reads brackets aloud as text.
- **User impact**: With Irodori, use the emoji tags (the palette switches automatically).

### D-05 Undo/Redo granularity 【変更】
- **What**: Typing on the same line within 1.2 s counts as one Undo step. Takes arriving from the engine are not part of the history.
- **Why**: Undoing one character at a time is impractical. Undoing a generation result would put the takes and the files on disk out of step.
- **User impact**: Undo cannot cancel "a take was generated" (delete the take instead). A deleted take's WAV is removed from disk on the next save, so Undo can bring it back until then.

### D-06 The voice library is global to the app, not stored per project 【変更】
- **What**: Voices are stored in `%APPDATA%\dev.voicestudio.app\voices\`, and reference WAVs are copied there. A project refers to a voice only by ID.
- **Why**: The plan did not specify where voices live. It makes the same voice reusable across projects.
- **User impact**: Moving a `.vsproj` to another PC does not bring its voices along (cast voices show as unavailable).

### D-07 Progress is shown as "seconds generated", not as a fraction 【変更】
- **What**: Drama-3 streams chunks and does not send a `progress` fraction, so the display is the seconds of audio generated so far.
- **User impact**: The percentage of the line is not shown.

### D-08 Lint uses `tsc` + `cargo clippy`; ESLint was not introduced 【変更】
- **What**: `npm run lint` runs a type check (`tsc`), and `npm run lint:rust` runs clippy `-D warnings`.
- **Why**: ESLint 9 and the React Hooks plugin had a peer dependency conflict, and installation failed.
- **User impact**: None for end users. For development, React Hooks dependency checks are not run.

### D-09 The scene's single-request take is attached to the scene, not to the lines 【追加】
- **What**: `Scene { lineIds, mode, takes, selectedTakeId }` was added to the project file. The plan's data model had no scene.
- **User impact**: None (an addition).

## Not implemented (planned in v1)

### D-10 The "run install.ps1 / download the release zip" button in model management 【変更・承認済み・実装済み】
- **What**: Only typing or picking the speech.exe path and showing its version are implemented.
- **Why**: Both options carry security and dependency trade-offs. The official procedure (`irm …/install.ps1 | iex`) **runs a remote script as is**. Downloading the zip inside the app would add an HTTP dependency to the Rust side (the GUI binary grows).
- **Alternatives**: (a) a button that runs the official install.ps1 after a confirmation dialog; (b) a button that opens the release page in the browser; (c) download the zip, check the SHA256SUMS, extract.
- **Decision (user, 2026-11-26)**: (c). Implemented: the "⤓ Download speech.cpp" button in model management and in Settings.
  It gets the latest release through the GitHub API, checks it against SHA256SUMS, and extracts it into `%LOCALAPPDATA%\dev.voicestudio.app\speech\<tag>\`, refusing paths that would escape the folder. **install.ps1 is not run.**
- **User impact**: The button does not add speech.exe to PATH (unlike install.ps1). The settings and every profile whose speech.exe is missing or unset now point at the downloaded speech.exe. See D-20 for the size increase.

### D-11 Queue ETA 【実装済み（承認により v1 で実装）】
- **What**: Remaining job count and seconds generated are shown, but no estimated finish time.
- **Implementation**: The toolbar shows "about N seconds left", from the mean time of the last 20 finished jobs × the jobs left, minus the elapsed time of the running job. No estimate is shown until the first job finishes.

### D-12 Copying and pasting lines (to the clipboard) 【実装済み（承認により v1 で実装）】
- **What**: Duplicating (Ctrl+D), multi-select, deleting and drag-reordering are implemented. Copying selected lines to the clipboard and pasting them as lines is not.
- **Implementation**: Ctrl+C / Ctrl+X / Ctrl+V when several lines are selected, or when no text field has focus, plus the ⧉ and 📋 buttons in the toolbar. The system clipboard receives `キャラ,テキスト` text. Pasting the same text back restores the options and silences; text from outside is imported as `キャラ,テキスト`, and missing casts are created.
- **Differences**: Pasted lines **do not carry takes** (only the settings are copied). If the system clipboard cannot be read (for example when the window is not focused), the in-app copy is used.

### D-13 Creating a multi-speaker voice by hand in the voice library 【実装済み（承認により v1 で実装）】
- **What**: A voice can be made from several references (joined as one speaker). The UI that assigns voices to speakers with `--speaker N` exists only in scene generation (automatic merging from cast order).
- **Implementation**: The voice library has a "Create a cast voice (multiple speakers)" section. You assign a voice to each `<|speaker:N|>` (up to 16; a speaker can be left as "none") and give it a name. A multi-speaker voice can also be chosen for a cast, shown as "(N 話者)".
- **Note**: With Drama-3-Japanese, only speaker 0 speaks in a single request (D-01), so this mainly matters for future models.

### D-14 Named presets (option sets) 【変更・v2 へ延期（2026-11-26 ユーザー判断）】
- **What**: Each cast's "default options" and each line's "options for this line only" are implemented. Named presets that can be saved and reapplied are not.

### D-15 i18n readiness 【未実装・v2 へ延期（2026-11-26 ユーザー判断）】
- **What**: The UI strings are Japanese, hard-coded in the components. There is no translation layer.

### D-16 Dragging several lines at once 【未実装・v2 へ延期（2026-11-26 ユーザー判断）】
- **What**: Drag reordering works one line at a time.

## Behavior notes and items not verified

### D-17 Pasting at the end of a non-empty line 【変更】
- **What**: When the pasted text is split into several pieces, the first piece is appended to the current line and the rest become new lines. Pasting into an empty line puts the first piece in that line.
- **User impact**: Pasting into the middle or end of a line also attaches the first sentence to that line.

### D-18 The installer (NSIS) build has not been verified 【未検証】
- **What**: The E2E used the `tauri build --no-bundle` executable.

### D-19 Debug handle in the GUI 【追加】
- **What**: `window.__voiceStudio` exposes the stores and actions (for E2E driven over the DevTools protocol).
- **User impact**: None (it is accessible from the WebView only, and DevTools is disabled in the release build unless an environment variable is set).

## Added in turn 2 (2026-11-26, after the decisions)

### D-20 The GUI binary gained an HTTP client and zip extraction 【変更】
- **What**: The Rust side now depends on `ureq` (rustls), `zip` (deflate only), `sha2` and `hex`, for D-10.
- **Why**: The user chose the in-app download (c).
- **User impact**: The release build `voice-studio.exe` is 5.2 MB. The memory used while running is unchanged, since the code only runs during a download.

### D-21 The `voice_combine` command takes a name 【追加】
- **What**: An optional `name` was added to name the manual cast voices of D-13. Automatic merging for scenes still names voices as before.
- **User impact**: None.

---

## Decisions
- D-01: **Approved** (2026-11-26) — "per line" is the default.
- D-10: **(c) download the zip, check its SHA, extract — approved and implemented** (2026-11-26).
- D-11, D-12, D-13: **Implement in v1 — implemented** (2026-11-26).
- D-14, D-15, D-16: **Deferred to v2** (not selected by the user, 2026-11-26).
