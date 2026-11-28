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
- **What**: A window event `vs-add-refs` adds reference audio to the voice library by path (since D-54, once the ボイス screen has been opened). This exists because the native file dialog cannot be driven from a script. It is the same kind of debug handle as `window.__speechorus`.
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
  - **Left rail** (`Rail.tsx`; ボイス and モデル became screens in D-54): キャスト shows or hides the cast panel, ボイス opens the voice library (the button left the cast panel), and モデル opens the model manager. At the bottom are エンジン and 設定.
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

### D-46 One playback volume slider in the top bar, up to 200% 【追加（ユーザー要望）】
- **What**: A volume control sits in the top bar, right of 連続再生/停止: a speaker button (mute / unmute) and a 0–200% slider with a mark at 100%. The mouse wheel over it steps 5%, and a double-click goes back to 100%. All playback goes through the one `<audio>` element in `src/lib/player.ts`, so it covers lines, takes, scenes, the voice library, voice design and the trimmer. The element's own `volume` stops at 1, so the element plays through Web Audio (element → GainNode → speakers, with `crossOrigin = "anonymous"`; the asset protocol answers with `Access-Control-Allow-Origin`). Up to 100% the slider position is squared for the gain, so equal steps sound about equal; above it the gain rises in a straight line to 2× (+6 dB) at 200%. Above 100% a limiter (DynamicsCompressor, threshold −1 dBFS, ratio 20) is put in the path so boosted peaks do not clip; at 100% and below it is taken out, because its make-up gain would change the level slightly. The level and mute are saved in `settings.json` (`playbackVolume`, 0.0–2.0, default 1.0, and `playbackMuted`), written 400 ms after the slider stops moving. Unmuting at 0% brings the level back to 50%.
- **Why**: The user wanted one place to set the volume, reachable at once from the main screen. Of the placements offered (beside the transport buttons, a speaker popover, the status bar), they chose the one beside the transport buttons. They then asked for more than 100%, up to 200%.
- **Not done**: The control is not reachable while a dialog covers the window (export or settings; the voice library is a screen since D-54); the level set before opening it still applies there. There is no keyboard shortcut. Where Web Audio is missing (not the case in WebView2), the volume tops out at 100%.
- **User impact**: Only what you hear in the app changes. Exported files keep the take's own level, so a take that needs 200% to sound right in the app is still quiet when exported. Above 100% the limiter flattens the loudest peaks.

### D-47 最近使ったファイル as a submenu of the ファイル menu 【追加（ユーザー要望）】
- **What**: The ファイル menu has a 最近使ったファイル item under 開く…; hovering it, clicking it, or → / Enter opens a nested menu to its right (`SubMenu` in `src/app/Menu.tsx`; ← closes it, Escape closes the whole menu). It lists the last 10 projects opened or saved, newest first: the project name with its folder under it, the full path as a tooltip, and 1–9 before the first nine, which choose that file from the keyboard. The open project is highlighted. 一覧をクリア at the end empties the list. The item is disabled while the list is empty. A file that cannot be opened (moved, deleted) is taken out of the list, with the error shown. The list is the `recentProjects` that the core already kept in `settings.json` (`push_recent_project`, called by `project_load` and `project_save`), which no UI showed until now.
- **Fix along the way**: After a save, the UI did not take the updated list from the core, and the UI writes the whole settings back (volume, theme, tags), so the next such write put the old list back. Open and save now copy only `recentProjects` from the core into the UI's settings; they used to replace the whole settings on open, which could drop a volume change not written yet (D-46).
- **Why**: The user asked for the usual recent-files menu, nested in a submenu.
- **Not done**: No pinning, and no list on the start screen or in the Windows taskbar jump list. Paths are compared as typed, so the same file reached through two spellings (case, a mapped drive) shows twice.
- **User impact**: Reopening a recent project takes two clicks from the ファイル menu.

### D-48 The app's own right-click menu, and no text selection across the UI 【修正（ユーザー要望）】
- **What**: Right-click no longer opens the WebView's menu (戻る / 再読み込み / 印刷 / 検証…). `src/app/ContextMenu.tsx` opens the app's own menu instead, and only where it has something to offer: in a text field (the line editor, inputs, textareas) 元に戻す / やり直し, then 切り取り / コピー / 貼り付け / すべて選択; on a script line, 生成, シーンにまとめる (two or more lines), 下に行を追加, 切り取り / コピー / 貼り付け of whole lines, 複製 and 削除, acting on the whole selection when the line is in it; on selected text elsewhere (the engine log), コピー. Anywhere else nothing opens. Right-clicking a line that is not selected selects it, as a click does; right-clicking inside a selection keeps it. 元に戻す / やり直し are the project's Undo/Redo, the same as Ctrl+Z / Ctrl+Y. Pasting into the line editor goes through its own paste handling, so a multi-line paste splits into lines as with Ctrl+V. In a dev build, Shift+right-click still opens the WebView's menu, for 検証.
- **Also**: Dragging the mouse across the UI used to select labels, buttons and line numbers like a web page. `user-select: none` is now set on the body; text fields, the CodeMirror editor, the engine log (`pre.log`), voice paths (`.path`) and anything marked `.selectable` can still be selected.
- **Why**: The user asked for the WebView menu to go, keeping only what fits the app, with copy / paste and Undo / Redo; and for the stray selection to stop.
- **Not done**: The menu is mouse-only (no arrow-key navigation inside it, no Menu / Shift+F10 key). Takes, cast, and voice-library items have no menu yet. Spell-check suggestions, which the WebView menu offered in text fields, are gone.
- **User impact**: Right-click is now a shortcut to the common line actions. Text in labels and messages can no longer be selected and copied, except in the places listed above.

### D-49 A `.vsproj` renamed by hand still finds its takes folder 【修正（ユーザー要望）】
- **What**: The takes folder used to be found only by name (`foo.vsproj` → `foo.takes`), so renaming the `.vsproj` alone in Explorer left the project with no audio. Saving now also records the folder's name (`takesDir`) and a project id (`id`) in the `.vsproj`, and writes the id into a marker file in the folder (`.speechorus-project`). Opening looks for `<name>.takes`, then the recorded folder, then a `*.takes` folder beside it whose marker holds the id (for when both were renamed). The next save renames the folder to `<name>.takes` when no `.vsproj` of the folder's own name is left (the file was renamed, not copied), and no job is writing into it; otherwise the takes are copied as with Save As. A copy (Save As, or a `.vsproj` copied by hand) gets an id of its own, and the folder's marker decides the id from then on. Files saved before this have neither member; they are filled in at the next save.
- **Why**: The user asked for the project and its audio not to come apart on a rename. Windows has no bundle folder like macOS packages; NTFS alternate data streams are lost on copies to FAT/exFAT, zip and cloud sync, and a single-file container (zip or SQLite) would change the playback path and the save cost, so the two-part layout stays and is made rename-safe.
- **Not done**: Moving the `.vsproj` to another folder without its takes folder still loses the audio (the search covers the same folder only). Renaming happens at save, not on open, so until then the files keep their old folder name.
- **User impact**: Renaming `foo.vsproj` to `bar.vsproj` and opening it shows its takes; saving it renames `foo.takes` to `bar.takes`. A `.speechorus-project` file appears in each takes folder.

### D-50 CI on pull requests and pushes to `main` 【追加（ユーザー要望）】
- **What**: `.github/workflows/ci.yml` runs on every PR into `main`, every push to `main` and by hand. Two jobs run in parallel and together cover `npm run check`:
  - `Frontend` on `ubuntu-latest`: `npm ci` (npm 11.19.1, D-43), `npm run deps:check`, `format:check`, `lint` (typecheck + Oxlint) and `test` (Vitest).
  - `Rust` on `windows-latest`, the platform the app targets: Rust pinned to 1.93.1 as in `release.yml`, `cargo fetch --locked`, `cargo fmt --check`, clippy (`--all-targets -D warnings`) and `cargo test` with the mock worker. The real-engine E2E (`tests/real_engine.rs`) skips itself, as no engine or model is present.
  - Read-only token (`contents: read`), actions pinned to commit SHAs, and a new push to the same PR cancels the run for the old head. A CI status badge is added to the README.
- **Why**: The user asked for the usual PR checks once the repository was public, where standard GitHub-hosted runners cost no minutes. This replaces the "no CI, save minutes" policy that D-42 kept for the private repository.
- **Not done**: The checks are not required by a branch protection rule or ruleset on `main` (a repository setting; add `Frontend …` and `Rust …` as required checks to block merging on a failure). The installer is not built in CI; `release.yml` still builds it.
- **User impact**: None to the app.

### D-51 A faster Rust CI job: the library is built as an `rlib` only 【修正（ユーザー要望）】
- **What**:
  - `src-tauri/Cargo.toml`: `crate-type = ["rlib"]` instead of Tauri's template `["staticlib", "cdylib", "rlib"]`. The other two types exist for iOS and Android; the Windows app links the `rlib` into `speechorus.exe` (`main.rs` calls `speechorus_lib::run()`), so nothing used them. Each debug build wrote an 868 MB `speechorus_lib.lib` and a DLL, and the release build ran LTO for all three. Locally, rebuilding the tests after a change to `lib.rs` went from 20 s to 14 s.
  - `ci.yml` (Rust job): `CARGO_PROFILE_DEV_DEBUG=0` and `CARGO_PROFILE_TEST_DEBUG=0` (no debug info in CI: smaller artifacts and cache, faster links), and no separate `cargo fetch --locked` step (clippy and test already pass `--locked`; the step mostly unpacked crate sources, which the build now does instead).
- **Why**: The user found the Rust job (about 5 min) slow. Most of those 5 min came from the first runs having no cache (about 1 min 50 s with a warm cache on `main`); these changes cut the rest.
- **Measured** (Rust job, `windows-latest`): cold 5 min 0 s → 4 min 40 s; warm (cache hit) 110 s → 97 s. `cargo test` with a warm cache went from 30 s to 13 s and the cache from 601 MB to 431 MB. Clippy went from 9 s to 32 s because unpacking the crate sources (27 s in the old `cargo fetch` step) now happens there. What is left of the warm run is mostly fixed cost: about 25 s restoring the cache, about 20 s unpacking crates, 12 s installing the toolchain.
- **User impact**: None to the app. Local debug builds no longer write the large `.lib` and DLL. Building for iOS or Android would need the two crate types back.

### D-52 The CI jobs are required to merge into `main` 【追加（ユーザー要望）】
- **What**: A repository ruleset "Require CI" (active, on the default branch) requires the two `ci.yml` checks, `Frontend (format, typecheck, Oxlint, Vitest)` and `Rust (rustfmt, clippy, cargo test)`, from GitHub Actions. The branch need not be up to date with `main` first. Repository admins may bypass it (for a broken CI). The disabled ruleset "main" (deletion, force push, Copilot review) is left as it was.
  - `bump.yml` now ends by starting `ci.yml` on `release/vX.Y.Z` with `workflow_dispatch` (`actions: write`). Its PR is opened with `GITHUB_TOKEN`, which triggers no `pull_request` workflow, so without this the release PR would never get the required checks.
- **Why**: The user asked for the CI jobs to block merging when they fail.
- **Not done**: The `bump.yml` change has not been run on GitHub (it would open a real release PR); try it at the next release. If the checks do not appear on the release PR, run `gh workflow run ci.yml --ref release/vX.Y.Z` by hand.
- **User impact**: None to the app. A PR into `main` cannot be merged until both jobs pass (about 2 min), and pushes straight to `main` are refused unless made by an admin bypassing the rule.

### D-53 Supply-chain and toolchain checks: cargo-deny, zizmor, Dependabot, `rust-toolchain.toml`, GitHub security features 【追加（ユーザー要望）】
- **What**:
  - **`rust-toolchain.toml`** (repo root): Rust 1.93.1 with clippy and rustfmt, `profile = "minimal"`. `ci.yml` and `release.yml` install it with `rustup toolchain install` instead of `dtolnay/rust-toolchain` with its own version, so local builds, CI and releases cannot drift apart. A `RUSTUP_TOOLCHAIN` environment variable still wins over the file.
  - **cargo-deny** (`src-tauri/deny.toml`, `npm run deps:deny`): RustSec advisories (yanked versions fail too), licenses, bans and sources of `Cargo.lock`, for the `x86_64-pc-windows-msvc` target only (Linux-only crates such as `glib` are left out). Allowed licenses: Apache-2.0, BSD-3-Clause, CDLA-Permissive-2.0, ISC, MIT, MPL-2.0 (Servo's `cssparser`, `dtoa-short`, `option-ext` via Tauri, used unmodified), Unicode-3.0, Zlib. Duplicate versions are reported as warnings. Only crates.io is allowed as a source. `publish = false` was added to `Cargo.toml` so that the app's own PolyForm license is not checked. Two advisories are ignored with a date: RUSTSEC-2026-0592 (`url`, fixed in 2.5.9, old enough from 2026-11-27 23:03 UTC) and RUSTSEC-2026-0594 (`cookie`, fixed in 0.18.3, from 2026-11-30 07:45 UTC); both are listed in D-45.
  - **zizmor** (`npm run lint:actions`, via `uvx zizmor@1.32.0`): it found 13 problems in the workflows, now fixed: `persist-credentials: false` on every checkout that does not push; `release.yml` has `permissions: {}` at the top and `contents: read` / `contents: write` per job; the `${{ }}` expressions in `run:` blocks of `bump.yml` (`github.ref_name`) and `release.yml` (step outputs) moved into `env:`. Suppressed inline with a reason: `artipacked` on the two checkouts that push (the release tag, the bump branch) and `adhoc-packages` on `npm install -g npm@11.19.1` (an exact version, needed by `.npmrc`).
  - **CI**: a third job in `ci.yml`, `Supply chain (cargo-deny, zizmor)` on `ubuntu-latest`, installs cargo-deny 0.21.0 from its GitHub release (checked against a pinned SHA-256) and runs `cargo deny --locked check`, then `zizmorcore/zizmor-action` (zizmor 1.32.0, annotations, no SARIF upload). cargo-deny 0.21 is used because 0.22 needs Rust 1.95 to build locally.
  - **Dependabot** (`.github/dependabot.yml`): weekly (Monday, JST) version updates for npm, Cargo and GitHub Actions, with `cooldown: 7 days` to match the release-age window; minor and patch updates are grouped per ecosystem, Oxfmt comes on its own (D-45), and actions move SHA and tag comment together.
  - **Repository settings** (GitHub, free for a public repo): Dependabot alerts and Dependabot security updates turned on; CodeQL default setup for `actions` and `javascript-typescript`. Secret scanning and push protection were already on. Rust is left out of CodeQL because its analysis is slow.
- **Why**: The user asked for the missing de-facto tools of the stack, free ones only. These replace tracking advisories by hand (D-45) and running `deps:update` as the only way to see updates.
- **Not done**:
  - `deps:deny` and `lint:actions` are not part of `npm run check`: they need cargo-deny and uv installed, and `release.yml` runs `npm run check`. CI runs both.
  - The new job is not a required check in the "Require CI" ruleset yet (add `Supply chain (cargo-deny, zizmor)` there to block merging on it). A new RustSec advisory will fail the job on unrelated PRs until it is fixed or ignored in `deny.toml`.
  - A Dependabot PR can still pull a transitive crate or package younger than 7 days into a lock file; `deps:check` fails such a PR, and `deps:update` or a later run fixes it. Security updates do not wait for the cooldown.
  - The `release.yml` and `bump.yml` changes have not been run on GitHub; try them at the next release.
- **User impact**: None to the app. Developers need uv for `lint:actions` and `cargo install cargo-deny --locked --version ~0.21` for `deps:deny`.

### D-54 ボイス and モデル are screens of the main pane, not dialogs 【仕様（ユーザー決定）】
- **What**: Supersedes the rail of D-37 in part.
  - **Rail** (`Rail.tsx`): the top group is now 台本, ボイス and モデル, which switch the main pane (`view` in `src/store/app.ts`). The screen on show is marked with `aria-current="page"` and a jade bar at the rail's edge. Below a separator, キャスト stays a toggle for the cast panel (`aria-pressed`; when on, only its icon is lit). Pressed on another screen, it goes back to the script with the panel shown. エンジン's モデル管理… now opens the モデル screen.
  - **Screens**: the voice library and the model manager are `Page`s (`src/app/Page.tsx`): a title and the content, scrolled on their own, with no close button. Each is mounted on its first visit and then kept hidden, so references being trimmed and transcribed, a voice being designed, or the profile chosen in the model manager survive going back to the script. The model manager reads the devices (free VRAM) again each time it is shown.
  - **Still dialogs**: 設定, 書き出し and モデルを入手 (the catalog, which now opens over the モデル screen and returns to it when closed).
  - **Shortcuts**: Ctrl/⌘+S and O and Space (play) work on every screen. The line shortcuts (undo/redo, copy/cut/paste lines, duplicate, Delete, Ctrl/⌘+Enter, Esc to clear the selection) work only while the script is on screen, so they cannot change lines the user cannot see.
- **Why**: The user found the modals out of place for a sidebar. Navigation rails (Material 3 Navigation Rail, Apple HIG sidebars, VS Code, Slack, Teams) switch between top-level destinations. A modal also suits short tasks, not a work area like the voice library, and Esc or a click on the backdrop threw away the references being prepared. Settings stays a dialog: it is small, and apps differ there (Slack and Notion use a modal).
- **User impact**: Opening ボイス or モデル replaces the script instead of covering it; press 台本 to go back. The top bar, the status bar (queue) and the volume control stay usable there. Work in progress on those screens is no longer lost by Esc.

### D-55 The release job has a time limit and reuses the Rust CI cache 【修正】
- **What**: The first release after D-53 (v0.1.6, run 46076601378) stayed in its `Checks` step (`npm run check`) for 40 min until it was force-cancelled; a plain cancel did not reach the runner, and no log was ever uploaded, so the Windows runner itself had stopped responding. `rust-toolchain.toml` (D-53) had changed the rust-cache key, so that run started from no cache and built every crate with debug info, which CI does not do (D-51). `release.yml` now:
  - sets `timeout-minutes: 45` on the `release` job (a release takes about 10 min; without a limit GitHub waits 6 h);
  - sets `CARGO_PROFILE_DEV_DEBUG=0` and `CARGO_PROFILE_TEST_DEBUG=0`, as the Rust CI job does (the installer build uses the release profile, which they do not touch);
  - restores the Rust CI job's cache: both use rust-cache `shared-key: windows-nodebug`, and the release job does not save (`save-if: false`), so its release-profile build does not bloat the cache.
- **Why**: The user asked for the cause of the stuck release and a fix before releasing v0.1.6 again.
- **Not done**: Why the runner stopped responding is not known (no log, no GitHub incident at that time); a heavier cold build may have played a part. The first CI run on `main` after this change saves the cache under the new key; a release started before that finishes builds without a cache (but without debug info).
- **User impact**: None to the app.

### D-56 React 19, and ureq 3 from Dependabot 【修正】
- **What**: Supersedes the "Not done" items of D-45 on React and `ureq`.
  - **React 18.3 → 19.3** (`react`, `react-dom` ^19.3.1, `@types/react` ^19.3.0, `@types/react-dom` ^19.3.0). Dependabot opened the react and react-dom majors as two PRs; each fails `npm ci` alone on the peer range, so they were taken in one change. No source change was needed: typecheck, Oxlint, the 88 Vitest tests and `vite build` pass. The bundle grows from 515.0 kB to 594.1 kB (167.3 → 190.1 kB gzip), as D-45 found. `dependabot.yml` now groups these four packages, all update types included, so a later major comes as one PR.
  - **`ureq` 2.12 → 3.5** (Dependabot PR #31). `downloads.rs` and `installer.rs` use the new API (`Agent::config_builder()`, `.header()`, `into_body()`). ureq 2's `timeout_read` becomes `timeout_per_read`, which also restarts on each read, so a stalled download still fails after 60 s and a slow one is not cut. One difference: ureq 3 fails to gunzip a 206 the server sent gzip-encoded (ureq 2 passed the bytes through), so resumable downloads now ask for `Accept-Encoding: identity`; the size and SHA-256 checks are on the file's own bytes anyway. Checked against the real hosts with a throwaway example: a range request to a Hugging Face binary and to GitHub raw text (206), the GitHub releases API JSON, and a 404 turning into an error.
- **Checked (React 19)**: the app under `npm run tauri dev`, driven over the WebView2 DevTools protocol with real mouse and key input. Typing a line (one Undo step), Ctrl+Z / Ctrl+Y, the line context menu and Esc, the 設定 and 書き出し dialogs, the ボイス and モデル screens, the volume slider and mute. With the Tauri runtime: starting Irodori-TTS and then switching to Drama-3-Japanese Q4_K from the モデル screen, generating a line with each (one take each: the StrictMode double mount registers the event listener once), playing a take, 採用, 連続再生, playing a voice reference, and a voice-design candidate. No console error or warning.
- **Not done**:
  - Two bugs found on the way are also in React 18.3 (tried on `main` the same way), so they are not from this update: the env and extra-args fields of the モデル screen keep the first profile's values when another profile is picked, when the first one had any (uncontrolled `defaultValue` without a `key`; leaving the field then saves them into the other profile), and Esc does not close 書き出し (Esc first clears the line selection, the dialog re-renders, and `Dialog` re-adds its keydown listener during that dispatch, so the new one is not called).
  - Dependabot updates only the SHA, not the `# vX.Y.Z` comment, when another comment follows it on the line (`# zizmor: ignore[...]`); fix the comment by hand in such PRs (done in #30).
- **User impact**: None expected. The app starts slightly slower to parse (+79 kB of JavaScript).

