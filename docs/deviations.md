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
- **What**: Voices are stored in `%APPDATA%\dev.speechorus.app\voices\`, and reference WAVs are copied there. A project refers to a voice only by ID.
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
  It gets the latest release through the GitHub API, checks it against SHA256SUMS, and extracts it into `%LOCALAPPDATA%\dev.speechorus.app\speech\<tag>\`, refusing paths that would escape the folder. **install.ps1 is not run.**
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

### D-18 The installer (NSIS) build 【検証済み（turn 3）】
- **What**: Up to turn 2, the E2E used the `tauri build --no-bundle` executable.
- **Turn 3 result**: Built `Speechorus_0.1.0_x64-setup.exe` (2.04 MiB). A silent per-user install (`/S`) went to `%LOCALAPPDATA%\Speechorus`, and the uninstall entry was registered in HKCU.
  With the settings moved aside to simulate a first run, the following all worked: start → download speech.cpp from Settings (SHA checked) → Drama-3 Q4_K from the catalog (an existing file in the destination is SHA-checked and reused) → profile created automatically → engine started → generation.
  A silent uninstall removed the install folder and the uninstall entry. See D-27 for what stays behind and D-28 for the bug this found.

### D-19 Debug handle in the GUI 【追加】
- **What**: `window.__speechorus` exposes the stores and actions (for E2E driven over the DevTools protocol).
- **User impact**: None (it is accessible from the WebView only, and DevTools is disabled in the release build unless an environment variable is set).

## Added in turn 2 (2026-11-26, after the decisions)

### D-20 The GUI binary gained an HTTP client and zip extraction 【変更】
- **What**: The Rust side now depends on `ureq` (rustls), `zip` (deflate only), `sha2` and `hex`, for D-10.
- **Why**: The user chose the in-app download (c).
- **User impact**: The release build `speechorus.exe` is 5.2 MB. The memory used while running is unchanged, since the code only runs during a download.

### D-21 The `voice_combine` command takes a name 【追加】
- **What**: An optional `name` was added to name the manual cast voices of D-13. Automatic merging for scenes still names voices as before.
- **User impact**: None.

---

## Added in turn 3 (2026-11-26, model catalog and installer)

Requested through the planning session: download models from inside the app, and verify the installer.
Before starting, the user allowed a test re-download of Q4_K (22 GB, deleted afterwards) and running the installer.

### D-22 The model catalog is a JSON file bundled with the app; local overrides are possible 【追加・方式】
- **What**: `assets/models/catalog.json` is built into the app, and `%APPDATA%\dev.speechorus.app\catalog.json` replaces it when present. The app does not fetch the catalog from the network.
- **Why**: Downloading a catalog from a remote source would be another trust boundary. A local file is enough to keep it up to date.
- **User impact**: Catalog changes reach users with an app update, or by placing the override file by hand.

### D-23 Irodori-TTS-mf and Qwen3-ASR are fetched with `speech pull`; the destination cannot be chosen 【変更】
- **What**: These two are fetched with `speech pull` into speech.cpp's own model folder (`%LOCALAPPDATA%\speech.cpp\models`). The destination field appears only for Hugging Face models (Drama-3).
  SHA-256 checking and resuming are done by `speech pull` itself (the catalog's `sha256` stays empty). Progress comes from its stderr (`N MB of M MB, P%, R MB/s`), and cancelling kills the process.
- **Why**: The request allowed `speech pull` for these two, and it keeps them in the same place as speech.cpp's catalog.
- **Verification**: Both models were already present, so in the E2E only the "done → set the ASR model / create a profile" path ran (0.3 s each). **The progress display and cancel/resume of `speech pull` were not verified end to end** (the progress-line parser has a unit test).

### D-24 Preselected vs recommended quantization 【仕様の明確化】
- **What**: The catalog default (Drama-3: **Q4_K**) is preselected. The variant that fits best is marked "推奨" (recommended): the largest supported variant whose estimated VRAM (from the model card: Q4_K 23.2 GiB, Q5_K 27.0 GiB) fits the GPU's free memory, or the total minus 1 GiB while the engine is loaded.
  On the RTX 5090 (30.7 GiB free) **Q5_K is marked 推奨** while Q4_K stays selected.
  When nothing fits, the smallest supported variant is recommended. The unsupported IQ3_XXS is never recommended.
- **User impact**: With 24 GB VRAM, Q4_K is marked 推奨 (and some experts may spill to the CPU; the card shows an estimate).

### D-25 Download behavior details 【仕様】
- Files are written to `.part` and resumed with `Range: bytes=N-`. On resume, the existing part is hashed first, so the final SHA-256 covers the whole file (about 1 s per GB).
- A server that ignores Range (Hugging Face's small non-LFS files such as `.gguf.json`) gets a fresh download.
- Sidecars are fetched first. A matching file already in the destination is SHA-checked and kept (22 GB took 38 s).
- The free-space check requires the remaining bytes + 1 GiB.
- On a SHA mismatch the `.part` file is deleted and an error is shown.
- Default destination: `%LOCALAPPDATA%\dev.speechorus.app\models\<model id>` (can be changed).
- A completed synthesis model gets the profile `<model id>-<variant>` (one with the same id is replaced) and it is selected. Drama-3 gets the three Vulkan env vars and `Vulkan0`. A completed ASR model becomes the transcription model in the settings.

### D-26 License consent is asked per download and not stored 【仕様】
- **What**: The checkbox in the dialog has to be ticked for each download. The Rust side also refuses a request without `licenseAccepted`.
- **User impact**: You agree again on every download (consent is not recorded).

### D-27 Uninstalling keeps user data 【仕様（Tauri 既定）】
- **What**: A silent uninstall keeps `%APPDATA%\dev.speechorus.app` (settings, voices) and `%LOCALAPPDATA%\dev.speechorus.app` (the downloaded speech.cpp, models, takes of untitled projects). The interactive uninstaller has Tauri's "delete app data" checkbox, but **the interactive uninstall was not verified**.
- **User impact**: Removing the app completely means deleting these folders as well (models can be large).

### D-28 The development-time speech.exe search (`.engine` under the working folder) is limited to debug builds 【バグ修正】
- **What**: In the installer E2E, the release build picked up the repository's `.engine\speech.exe` on first run. Searching the working folder now happens only in debug builds.
- **User impact**: On an installed app's first run, speech.exe is unset until you download it with the button or enter its path.

## Added in turn 4 (2026-11-26, feedback from manual testing)

Requests: (1) a way to stop playback, (2) choosing a Drama-3 voice by text prompt alone (a)(b), (3) a gear icon for settings, (4) trimming reference audio by range.

### D-29 Play buttons toggle pause/resume 【仕様の選択 → 2026-11-26 ユーザー判断で「一時停止」に変更（turn 5）】
- **History**: Turn 4 implemented "stop" (no resuming from the middle). The user decided "一時停止に変える" (change it to pause), so turn 5 changed it to the following.
- **What (now)**: Every play button (line, take, continuous playback, scene, reference preview, voice list, voice design candidates, range preview) works like this:
  - ▶ plays; pressing it while playing pauses (⏸); pressing it again resumes from **the same point** (while paused, the button shows a highlighted ▶ with the tooltip 「再開」 (resume)).
  - When playback reaches the end, the button returns to ▶, and the next press plays from the start.
  - Starting a different playback **stops** the previous one and drops its position.
  - Continuous playback: resuming after a pause continues from the same point of the same line and then plays the following lines. A pause during the silence between lines resumes with the **rest of that silence** (the silence after one line and before the next is treated as one pausable wait).
  - Stopping and going back to the start: while anything is playing or paused, a "■ 停止" button is shown in the toolbar.
  - Space: toggles pause/resume while something is playing or paused. With nothing playing, it plays the active line.
- **Verification (real app)**:
  - One line (4.88 s): play 1 s → pause 2 s → resume; it ended at 7.03 s, which equals the take's length plus the pause, so the position was kept.
  - Continuous playback: a pause 1 s into the 2 s silence, held for 3 s, resumed with the remaining 1.0 s. A pause 1 s into line 2, held for 2 s, resumed and continued to line 3. Ended at 17.8 s (expected 17.59 s).
  - Space toggles pause/resume, and ■ stop returns to the start.
- **User impact**: None (as requested).

### D-30 The settings button is a gear; the model management button loses its gear 【変更】
- **What**: The settings button (formerly ☰) is now a gear SVG icon. The old "⚙ モデル" button became "モデル管理" (text only), so there are not two gear buttons.

### D-31 The waveform is computed by the Rust side (hound), not decoded with Web Audio 【方式の変更（軽微）】
- **What**: The request suggested decoding with Web Audio and drawing on a canvas. Instead, `wav_peaks` reads the WAV in Rust and returns 640 min/max pairs, which the front end draws on a canvas.
- **Why**: Decoding in the WebView would need `fetch` of the asset URL, which means widening the CSP (`connect-src`). Sending only the peak summary keeps the WebView from holding whole audio files, which is lighter.
- **User impact**: None (no new library; the display is equivalent).

### D-32 Trimming details 【仕様】
- **What**: Cutting always starts from the original file. The result is written as 16-bit mono to `%APPDATA%\dev.speechorus.app\voices\trimmed\<name>_<start>-<end>_<id>.wav`, and the original is not changed. The cut is transcribed again automatically (for Drama-3). "元の音声に戻す" (back to the original) is available. The two handles stay at least 0.2 s apart.
- **Length guide**: 10–30 s is recommended. Under 3 s and over 30 s are warnings; 3–10 s is a note. Nothing is refused.
- **User impact**: Trimming a multi-channel WAV produces mono (speech voice mixes to mono anyway).

### D-33 Prompt-only voices (a) 【仕様】
- **What**: A voice record has a `prompt` field (with no file) and is registered with "説明だけで登録" (register the description only). When it is assigned to a cast, generation sends `voice none`, and the description becomes a leading `[..]` cue for Drama-3 or `instructions` for Irodori. If the cast has its own "voice design", that one wins.
  A prompt-only voice cannot be part of a multi-speaker cast voice file. In a single-request scene, that speaker's description is added as a cue on its first turn.
- **User impact**: The cast list labels these voices "（説明のみ）" (description only).

### D-34 Fixing a voice from candidates (b): an ASR check of each candidate was added 【追加（要求外）】
- **What**: As requested, the flow is: description + sample sentence → N candidates with consecutive seeds → listen → "この声で固定" (fix this voice) → `speech voice` with that WAV, using the sample sentence without cues as the transcript.
  **Addition**: after generation, each candidate is transcribed by ASR automatically. Candidates that look as if they did not read the whole sentence are marked "⚠ 読み切れていない可能性" (may not have read it all), and fixing one asks for confirmation.
- **Why**: In the E2E, one Drama-3-Japanese candidate (seed 49530482) stopped before the last clause of the sample sentence (「最後まで精一杯がんばりますね」 was missing). Fixing it with the full sentence as its transcript would give a voice whose transcript and audio disagree.
  The transcript is still the sample sentence, as the request says; ASR is used only to warn. The check compares an LCS of ≥ 75% and the last two characters, because ASR may write kana as kanji (頑張り for がんばり). In the in-app retest, 4 candidates that read the whole sentence all showed ✓.
- **Other**: Candidates are saved to `<takes folder>\design\` and are not stored in the project (they are cleared when the app restarts). The fixed voice's note records the description and the seed. Irodori uses the same UI (no transcript is needed).
- **User impact**: Each candidate costs about 1 s of ASR.

### D-35 Debug hook for E2E 【追加】
- **What**: A window event `vs-add-refs` adds reference audio to the voice library dialog by path. This exists because the native file dialog cannot be driven from a script. It is the same kind of debug handle as `window.__speechorus`.
- **User impact**: None.

### D-36 The app is renamed from Voice Studio to Speechorus 【仕様（ユーザー決定）】
- **What**: The temporary name "Voice Studio" clashed with existing software, so the app is now **Speechorus** (Speech + Chorus). A web search found no product with a similar name; trademark databases were not checked.
  - `productName`, the window title and the UI strings are now Speechorus.
  - The bundle identifier is `dev.voicestudio.app` → `dev.speechorus.app`, which moves the data folders to `%APPDATA%\dev.speechorus.app\` and `%LOCALAPPDATA%\dev.speechorus.app\`.
  - The NSIS install folder is now `%LOCALAPPDATA%\Speechorus`.
  - The Cargo package is `speechorus` (exe `speechorus.exe`, lib `speechorus_lib`) and the npm package is `speechorus`.
  - The User-Agents are `speechorus-downloader` and `speechorus-installer`.
  - The debug handle is `window.__speechorus`.
  - The environment variable is `VOICE_STUDIO_SPEECH` → `SPEECHORUS_SPEECH`.
- **Not changed (user decision)**:
  - Data in the old folders is **not migrated**: settings, voices and downloaded speech.cpp and models start empty under the new identifier.
  - The old environment variable name is **not read**.
  - The project file extension stays `.vsproj`.
  - The internal event `vs-add-refs` and the repository folder `voice-studio` keep their names.
- **Docs**: The paths and names in the entries above were rewritten to the new names. Those entries were verified while the app was still called Voice Studio (for example, the Turn 3 installer was `Voice Studio_0.1.0_x64-setup.exe`).
- **User impact**:
  - An existing install keeps its old folder and uninstall entry; uninstall it separately.
  - Voices and models must be registered or downloaded again, or the old folders copied by hand.

### Note: test data
- The voices made during the E2E remain in the voice library: 落ち着いた女性, 明るい声, the cast voices, 手動キャスト, プロンプト女性, and **固定した女性** (made from a candidate that stopped early; recommended for deletion). They have not been deleted, since that is permanent and needs the user's confirmation.

---

## Decisions
- D-01: **Approved** (2026-11-26) — "per line" is the default.
- D-10: **(c) download the zip, check its SHA, extract — approved and implemented** (2026-11-26).
- D-11, D-12, D-13: **Implement in v1 — implemented** (2026-11-26).
- D-14, D-15, D-16: **Deferred to v2** (not selected by the user, 2026-11-26).
- Turn 3: the user **allowed** the test re-download of Q4_K (deleted after the check) and running the installer and uninstaller (2026-11-26). D-22 to D-28 were done within the request and are recorded here for the planning session's check.

### D-37 UI redesign: Mineral Sage colors, a left rail, and a slimmer top bar 【仕様（ユーザー決定）】
- **What**: The user picked pattern C out of three proposals (layout and colors).
  - **Colors**: The navy and blue tokens are replaced by sage-tinted neutrals with one jade accent: `#4FC3A1` on `#121715` in dark and `#0F6E5A` on `#EEF0EB` in light. Tags use ochre. Only `src/styles.css` tokens changed, so dialogs follow automatically.
  - **Top bar** (`TopBar.tsx`, which replaces `Toolbar.tsx`): it holds only the ファイル menu, the project name with an unsaved mark, a 生成 split button, 連続再生/停止 and 書き出し.
    - The ファイル menu holds new/open/save/save as/import, plus undo/redo under 編集.
    - The ▾ of the 生成 button holds 未生成/全行 and the takes-per-line and seed settings.
  - **Left rail** (`Rail.tsx`): キャスト shows or hides the cast panel, ボイス opens the voice library (the button left the cast panel), and モデル opens the model manager. At the bottom are エンジン and 設定.
    - The エンジン panel holds profile choice, start/switch/stop, モデルを入手 and モデル管理.
    - When the chosen profile has no model (as on a first run), the panel's main button is モデルを入手… instead of 起動/切替, which would only fail, and the status bar says 「<profile> のモデルが未設定です」 with a モデルを入手… button. This replaces the old toolbar's highlighted ⤓ モデルを入手; nothing is shown once a model is set.
  - **Selection bar** (`SelectionBar.tsx`): it appears above the script when 2+ lines are selected, with 生成, シーンにまとめる, コピー, 複製, 削除 and clear.
  - **Status bar** (`StatusBar.tsx`): it shows the queue (remaining jobs, running seconds, ETA, 中止) and the loaded model.
  - Emoji buttons in the main window (🗋📂💾📥⚡🎬🗑✕ etc.) are now line icons (`icons.tsx`). Shortcut hints show ⌘ on macOS and Ctrl+ elsewhere.
- **Supersedes**: the toolbar placements in D-11 (the ETA, now in the status bar), D-12 (the ⧉/📋 buttons) and D-29 ("■ 停止", now beside 連続再生 in the top bar). The behavior is unchanged; only the place moved.
- **Not changed**: dialogs other than their close button keep their own buttons and glyphs. The keyboard shortcuts are unchanged.
- **User impact**: Pasting lines no longer has a button; use Ctrl/⌘+V. Copying is also in the selection bar.

### D-38 A take's seed is copied by clicking it, and a pasted seed generates one take 【追加（ユーザー要望）】
- **What**: In the take list, clicking 🎲<seed> copies the number to the clipboard. Under the take panel's heading, a seed box (「🎲 シードを貼り付け」) and 「このシードで生成」 (or Enter) make one take of the active line with that seed, using the line's current text, voice and options. The box keeps its value when another line is selected, so one seed can be tried on several lines.
  - Pasting accepts `🎲123`, spaces and `,`. Anything that is not a whole number from 0 to 2^53−1 disables the button (a larger value would be rounded as a JS number and not reproduce the take).
  - Ctrl/⌘+C/V in any `<input>`/`<textarea>` now always act on the field, even with several lines selected (before, they could copy or paste whole lines).
- **Why**: The user asked for it. The ▾ 固定 seed already existed, but it is a batch setting for every line and is hidden in a menu.
- **User impact**: None to existing projects; the seed is not saved in the project.

### D-39 Scratch audio is cleaned up: a per-instance work folder, scratch design/trim files, prune on open 【追加（ユーザー要望）】
- **What**: Generated WAVs no longer pile up where nothing refers to them.
  - Each running app gets `work/<uuid>/` in the local app data dir and holds `.lock` in it open without sharing. At start, the app removes every other folder under `work/` that no running instance holds, so folders left by an exit or a crash go away and a second running instance is left alone.
  - An untitled project's work folder (`project_new`) is deleted once the project has been saved elsewhere, or when the UI leaves it for 新規 / 開く (`project_release`). It is kept while a queued or running job still writes into it; the next start sweeps it then.
  - Voice-design candidates go to `work/<uuid>/design/` instead of `<takes>/design/` (which prune never looked into). 「候補をクリア」 deletes them.
  - Trimmed references go to `work/<uuid>/trimmed/` instead of `voices/trimmed/`. A cut is deleted when it is re-cut, reset or removed, and when 「作成」 has copied it into `voices/refs/`. The old `voices/trimmed/` is removed at start.
  - Opening a project prunes its takes folder too, not only saving. Prune skips the WAV the running job is writing (before, saving during generation could delete it).
- **Why**: The user asked for it. These files were never removed: the untitled work folders were only copied on save, and design and trim files had no cleanup at all.
- **User impact**: An untitled project's takes are gone once the project is discarded. They could not be reopened before either. Unsaved takes of a saved project are removed the next time it is opened. Old design candidates under `<project>.takes/design/` from earlier versions are not touched.

### D-40 Prune and Save keep the WAVs the Undo/Redo history can bring back 【修正】
- **What**: When saving, the UI collects every take named in the Undo and Redo stacks (`historyTakeFiles`) and passes them as `keep` to `project_save` and `project_prune`. Save copies them along (Save As, and an untitled project's first save), and prune leaves them. Names that are not a bare file name are ignored.
- **Why**: Saving pruned the WAV of a deleted take while the deletion could still be undone, so 「削除 → 保存 → Undo」 brought back a take with no file. D-39 made it worse for untitled projects, whose work folder is deleted after the first save.
- **User impact**: A deleted take's WAV stays on disk while the history holds it (up to 300 steps, until the project is closed or the app exits). It is removed by the next save after it leaves the history, or when the project is next opened (D-39). After Save As, the new takes folder also gets these WAVs.

### D-41 Undo/Redo keeps takes that arrived after the step 【修正】
- **What**: After an Undo or Redo is applied, any take that was on a line or scene before, is gone after, and does not appear in that history step's patches is put back at the end of the takes (`keepUnknownTakes`). If the step left the selection on a take that no longer exists, the previous selection is kept.
- **Why**: immer records `takes = takes.filter(...)` and `lines = lines.filter(...)` as replacing the whole array. Takes are not part of the history (D-05). So undoing 「テイクを削除」 or 「行を削除」 put back the old array, and takes generated after that step disappeared from the project, and their WAVs were then pruned at save.
- **User impact**: None except the fix. A take the step itself removed or restored still follows Undo/Redo.

### D-42 GitHub Actions workflows bump the version by PR and publish a draft release 【追加（ユーザー要望）】
- **What**: Two workflows; neither pushes commits to `main`, so a branch protection on `main` needs no extra token.
  - `bump.yml` (`workflow_dispatch` only, `ubuntu-latest`). Inputs: `bump` (patch / minor / major) and `version` (an explicit semver that overrides `bump`). It writes the new version into `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`, commits `Release vX.Y.Z` to `release/vX.Y.Z` and opens a PR into the branch it was run from. It stops if the tag or the branch already exists.
  - `release.yml` runs on a push to `main` that touches `package.json`, or by hand from `main`. A small `ubuntu-latest` job checks that the three version fields agree, and on a push releases only when the version differs from the previous commit's and its tag does not exist yet. Then on `windows-latest`: `npm run check`, `npx tauri build --bundles nsis`, push the annotated tag `vX.Y.Z` on the built commit, create a **draft** release with generated notes, `Speechorus_X.Y.Z_x64-setup.exe` and `SHA256SUMS.txt` (a version with a `-` suffix is marked pre-release), and delete the `release/vX.Y.Z` branch. Nothing is tagged if the checks or the build fail; run it again by hand to retry.
- **Why**: The user asked for it, and for it to work under branch protection without a token. A PR merged by a person triggers `release.yml` (a PR or push made with `GITHUB_TOKEN` would not trigger other workflows). It is not CI: nothing runs on PRs, and pushes to `main` start only the small gate job when `package.json` changes, so the "no CI, save minutes" policy holds (one release uses Windows runner minutes).
- **Toolchain**: `release.yml` pins Rust to 1.93.1, the local version, instead of `stable`. The first release run used stable 1.100, whose new clippy lint (`chunks_exact_to_as_chunks`, an error under `-D warnings`) failed `npm run check`. Raise the pin together with the local toolchain.
- **Setup**: Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests" must be on for `bump.yml` to open the PR. A tag ruleset on `v*` would block the tag push.
- **Not done**: The installer is not code-signed (SmartScreen warns on first run), and there is no Tauri updater. The workflows have not been run on GitHub yet.
- **User impact**: None to the app. Releases are published by hand from the draft.

### D-43 Dependency updates and supply-chain hardening 【追加（ユーザー要望）】
- **What**: Dependencies were updated to the newest semver-compatible versions that are **at least 7 days old**, and that age window is now enforced on every install.
  - **npm** (`.npmrc`, needs npm 11.19+; `devEngines` in `package.json` fails `npm install`/`ci`/`run` on an older npm or Node < 22.12): `min-release-age=7` (versions published less than 7 days ago are not resolved), `strict-allow-scripts=true` (install scripts run only for packages listed in `package.json` `allowScripts`, pinned per version; today only `esbuild@0.25.12`, whose postinstall checks its platform binary), `allow-git=none` (no git dependencies), `engine-strict=true`. Four direct dependencies had a floor younger than the window, so their range floor was lowered to the newest version old enough: `@codemirror/view` ^6.43.15, `@types/react` ^18.3.31, `lint-staged` ^17.6.1, `typescript-eslint` ^8.73.0. Several transitive packages moved back the same way.
  - **Cargo** has no such setting, so `scripts/cargo-release-age.mjs` checks every crates.io package in `src-tauri/Cargo.lock` against the sparse index's `pubtime` (versions from before `pubtime` existed count as old) and also rejects yanked versions. `--fix` moves each violation back to the newest compatible version that passes (`cargo update --precise`). `cargo update` found only `cc`, `find-msvc-tools` and `plist` behind; after the age check 19 lock entries are a patch or minor older than before (e.g. `hyper` 1.12.0, `wry` 0.57.3, `anyhow` 1.0.104). The check runs in the pre-commit hook when `Cargo.lock` is staged.
  - **Scripts**: `npm run deps:update` (npm update, cargo update, then the Cargo age fix) and `npm run deps:check` (`npm audit signatures` and the Cargo age check).
  - **Workflows**: every action is pinned to a commit SHA (the tag in a comment), Node 24 with npm pinned to 11.19.1, and `release.yml` runs `cargo fetch --locked` and `npm run deps:check` before `npm run check`.
- **Why**: The user asked for the newest non-breaking versions and for protection against supply-chain attacks such as a hijacked package version (most are found and unpublished within days), install-script malware, or a moved action tag.
- **Not done**: Major updates are left out as breaking: React 19, Vite 7/8, Vitest 4/5, TypeScript 6/7, `@vitejs/plugin-react` 5/6, and on the Rust side `ureq` 3, `zip` 3+, `sha2` 0.11. `npm audit` reports advisories in Vitest 3's `@vitest/mocker` and `tinypool` (dev only, the test runner; fixed in D-44). The workflow changes have not been run on GitHub yet.
- **Workaround**: To take an urgent fix that is younger than 7 days, add the package to `min-release-age-exclude` in `.npmrc` for that install (Cargo: `CARGO_MIN_RELEASE_AGE_DAYS=0`), then remove it again. A new dependency with an install script needs `npm approve-scripts <pkg>` after reviewing the script.
- **User impact**: None to the app. Developers need npm 11.19+, and `deps:check` and the Cargo.lock pre-commit check need network access.

### D-44 Vitest 4 for the test-runner advisories 【修正】
- **What**: `vitest` ^3.2.7 → ^4.1.12 (devDependency). 4.1.12 (2026-10-15) is the newest 4.x past the 7-day window; 4.1.11 is not enough, because `npm audit` flags `@vitest/mocker` <=4.1.11. Vite stays at ^6.4.6 and `@vitejs/plugin-react` at ^4.7.0: Vitest 4 accepts Vite 6, 7 or 8. `vite.config.ts` and the test files needed no change (no `poolOptions`, `workspace`, coverage or browser mode, and no `vi.fn` used as a constructor).
- **Why**: Vitest 3 pulled in `@vitest/mocker` (GHSA-82fw-gwwq-j7x9, GHSA-qxg6-89mg-rqv8) and `tinypool` (GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr), which D-43 left open as a major update. Vitest 4 drops `tinypool`. `npm audit` now reports no vulnerabilities.
- **Not done**: Vitest 5 and the other major updates listed in D-43.
- **User impact**: None to the app (dev only).

### D-45 Major updates that were tested: Vite 8, Vitest 5, TypeScript 7 with Oxlint, Oxfmt, zip 9 【修正】
- **What**: Major updates that pass every check and were tried in the app, each the newest version at least 7 days old (D-43):
  - `vite` ^6.4.6 → ^8.3.8 and `@vitejs/plugin-react` ^4.7.0 → ^6.3.0 (plugin-react 6 needs Vite 8). The config needed no change. `vite build` went from about 0.9 s to 0.2 s inside Vite (2.0 s → 1.25 s in all), and the bundle is slightly smaller (507.6 kB → 503.3 kB). Vite 8 no longer uses esbuild, so the `esbuild` entry in `allowScripts` was removed: no installed package has an install script now.
  - `vitest` ^4.1.12 → ^5.1.1. The 66 tests pass unchanged.
  - **ESLint → Oxlint, TypeScript 5.9 → 7.0.2.** typescript-eslint supports only TypeScript `<6.1.0`, and it was the only package that needed the `typescript` package, so ESLint was replaced by Oxlint (`oxlint` ^1.94.0, `.oxlintrc.json`; `eslint.config.js` removed, along with `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-config-prettier`, `eslint-plugin-react-hooks` and `globals`). The config keeps the old rule set: Oxlint's `correctness` category (which covers most of `eslint:recommended`), the typescript-eslint `recommended` rules listed by name, `react-hooks/rules-of-hooks` (error) and `exhaustive-deps` (warn), `no-unused-vars` with the `^_` patterns, and Node globals plus `no-undef` for `vite.config.ts` and `scripts/`. The React Compiler rules that Oxlint's react plugin puts in `correctness` (`immutability`, `set-state-in-effect`, `refs`, ...) are turned off, as they were before. It lints the same 48 files with 0 problems. Probe files confirmed that `any`, unused variables, conditional hooks and missing effect dependencies are still reported, and that the existing `eslint-disable-next-line react-hooks/exhaustive-deps` comments are honored. Oxlint has no Prettier-conflicting rules in this set, so no counterpart of `eslint-config-prettier` is needed. TypeScript 7 (the native compiler) needed one tsconfig change: `vite/client` in `types`, because the new side-effect import check reports `import "./styles.css"` otherwise. Timings including npx startup: typecheck 2.1 s → 1.2 s, lint 2.2 s → 1.0 s.
  - **Prettier → Oxfmt** (`oxfmt` ^0.79.0, `.oxfmtrc.json` made with `oxfmt --migrate=prettier`: `printWidth` 120, `trailingComma: all`, `sortPackageJson: false`, and the `.prettierignore` patterns, which also keep Markdown unformatted). `.prettierrc.json` and `.prettierignore` were removed. Oxfmt formats the repo exactly as Prettier did (no file changed), and probe files of each type (TS, CSS, JSON, HTML, YAML) came out identical from both. `format:check` takes 1.0 s instead of 1.9 s with npx startup (the formatting itself takes under 10 ms). Oxfmt is still 0.x, so its output may change between minor versions; the caret range `^0.79.0` holds it within 0.79.x, and a minor update should be taken on its own and reformat in one commit. lint-staged passes `--no-error-on-unmatched-pattern` because Oxfmt exits with an error when every file it is given is ignored (e.g. `package-lock.json`).
  - Rust: `zip` 2 → 9 (9.8.1). zip 2.x has advisories that are fixed only in 9.x (RUSTSEC-2026-0367/0368/0369/0429/0545/0548: symlinks, SUID bits, AES, stream reader). `installer::extract` writes regular files itself and checks `enclosed_name()`, so it did not reach those paths, but 2.x gets no more fixes. The only code change is that `ZipFile::name()` now returns a `Result`. Also `sha2` 0.10 → 0.11 and `base64` 0.22 → 0.23, versions other crates in the tree already use. Neither needed a code change, and the hash and PCM tests pass.
- **Checked**: `npm run check`, `npx tauri build --no-bundle`, `npm run build`, and the UI under `vite` dev in a browser (adding a line, typing, Undo, the ファイル menu) with no console errors.
- **Not done**:
  - React 19 passes the typecheck, the tests and the same UI steps, but the bundle grows by 79 kB (+23 kB gzip). It has no security fix for this client-only app, and the flows that need the Tauri runtime (engine, playback, dialogs) were not tried, so the app stays on React 18.3.
  - `ureq` 3 rewrites the API (`downloads.rs`, `installer.rs`) and 2.12 has no advisory, so it stays.
  - The release-age window holds back two security fixes: `url` 2.5.9 (RUSTSEC-2026-0592, stack overflow in `Url::origin()` on nested `blob:` URLs) is old enough from 2026-11-27 23:03 UTC, and `cookie` 0.18.3 (RUSTSEC-2026-0594, nonces after `fork`, which Windows does not do) from 2026-11-30 07:45 UTC. Both come in through Tauri. Take them with `cargo update -p url -p cookie` once they are old enough.
  - These advisories have no fix to take: `chrono` and `proc-macro-error` are unmaintained, and `glib` 0.18 is unsound (Linux only). All three come from Tauri.
- **User impact**: None expected. The installer extraction (zip 9) is covered by the unit test (`extracts_and_refuses_zip_slip`) but not by a real speech.cpp download.
