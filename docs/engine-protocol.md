# Engine verification spike (speech.cpp v0.11.2)

Measured on 2026-11-26 on the development machine: RTX 5090 (32 GB, `Vulkan0`), Ryzen 7 9800X3D, 64 GB RAM, Windows 11.
Binary: official `speech-0.11.2-windows-x64-vulkan.zip`, SHA-256 `2cf46f03…a58586`, checked against the release's `SHA256SUMS`.
Model: `Drama-35B-A3B-Japanese-v3-Q4_K.gguf` (22,359,473,504 B, SHA-256 `f624da9d…8482dd`, checked) with its `.gguf.json` sidecar.
Env for every Drama-3 run: `GGML_VK_DISABLE_F16=1 GGML_VK_DISABLE_COOPMAT=1 GGML_VK_DISABLE_COOPMAT2=1`. Every run also sets `SPEECH_NO_UPDATE_CHECK=1`.

## Conclusion

**Use `speech worker`.** It supports everything Voice Studio needs: `add_voice` at runtime (no model reload), streaming PCM chunks, `cancel`, `count_tokens`, `info`. There is no need for the `serve` + restart fallback.

## Worker protocol (protocol 4)

Source: `docs/worker.md` in nyosegawa/speech.cpp at v0.11.2; every point below was also checked against the real binary.

- Start: `speech worker MODEL [--add-voice NAME=FILE]... [--device NAME] [--threads N] [--no-warmup] [request option flags]`.
- JSON Lines on stdin/stdout, UTF-8. **stdout carries only the protocol**; every log goes to stderr.
- First line: `{"type":"ready","protocol":4,"version":"0.11.2","defaults":{},"model":{…}}`, or `{"type":"fatal","error":{code,option,message}}` and exit 1 (2 for a bad command line).
  - `model` holds `name`, `architecture` (`drama3` / `irodori-tts`), `sample_rate`, `voices`, `voice_files`, `voice_codec`, `voice_recordings`, `max_text_tokens`, `options[]` (name, type, default, min/max, choices), `device`, `threads` and more.
- Requests (each has a unique string `id`):
  - `synthesize` `{id, text, voice, …options}` → `chunk {id, seq, pcm}`* (base64 s16le mono at `sample_rate`), maybe `progress {id, done}`, then a terminal message.
  - `add_voice` `{id, name, path}` → `end {id}`. Drama-3 takes `.voice.gguf` only; Irodori also takes a WAV.
  - `count_tokens` `{id, text}` → `end {id, tokens}` (answered at once, even during a synthesis).
  - `info` `{id}` → `end {id, model, defaults}` (lists the voices added).
  - `cancel` `{id}` → no answer of its own; the request ends with `cancelled {id}`.
- Exactly one terminal message per request: `end`, `error {id, error}` or `cancelled {id}`.
- `end` of a synthesis: `{seed, samples, stop}` where `stop` is `complete`, `max_seconds` or `model_limit`.
- A member a request type does not have is refused (`invalid_argument` naming it) — so adapters must send only options the model takes.
- Closing stdin makes the worker finish and exit 0.

## Measurements

| Check | Result |
|---|---|
| `speech devices --json` | `Vulkan0` RTX 5090, 33.75 GB total / 32.9 GB free; `CPU` 68.3 GB |
| `speech info MODEL --json` | same object as `ready.model`; prints in milliseconds without loading |
| Drama-3 Q4_K worker start → `ready` | 13.4 s (file cold-ish), 5.3–6.3 s with the file in the OS cache |
| Drama-3 Q4_K VRAM | ~23.5 GiB above idle (27.5 GiB peak total with ~4 GiB idle desktop); all experts on GPU |
| Drama-3 synthesis, `[驚いて]本当に？[明るく]それは楽しみだね。` | 4.9 s audio, first audio 0.28 s, total 3.0 s (RTFx ~1.6–2.1); 5 chunks |
| Drama-3 with a voice design prompt `[落ち着いた25歳の女性。]…` | 5.8 s audio in 3.1 s |
| Drama-3 `cancel` during a synthesis | `cancelled` within ~0.3 s |
| `add_voice` of a `.voice.gguf` on a running worker | `end` in < 10 ms; `info` then lists it (`speakers 0 and 1` for a 2-speaker file) |
| **`speech voice drama-3 ref.wav --transcript … out.voice.gguf`** (5.8 s ref, default device CPU) | **3.2 s, peak working set 1.16 GB**, output 5.6 KB. Only the codec is read; the 22 GB model is *not* loaded. Safe to run while the worker is resident. |
| `speech voice drama-3 a.voice.gguf b.voice.gguf --speaker 0 --speaker 1 cast.voice.gguf` | 0.6 s, 0.87 GB peak |
| `speech asr qwen3-asr-0.6b --format json --language ja ref.wav` | ~1 s total (load 0.6 s on Vulkan0, 5.8 s audio in 0.16 s), 0.9 GB peak; JSON `{"file","text","stop","languages"}` per file on stdout (UTF-8) |
| Irodori-TTS-mf worker start → `ready` | ~2 s from cache; 48 kHz; first request 2.7 s (warm-up of shapes), next 0.18 s |
| Irodori `speech voice irodori-tts-mf ref.wav out.voice.gguf` | 1.2 s |

ASR of the Drama-3 outputs returned the input text (tags removed), so synthesis is correct on Vulkan with the three env flags.

## Findings that change the design

1. **Multi-speaker `<|speaker:N|>` in one request does not work with Drama-3-Japanese (this finetune).**
   With a 2-speaker cast voice and with `voice none`, with and without spaces/newlines, 4 seeds: the model always speaks only speaker 0's turn and stops with `stop: complete` (ASR hears only speaker 0's text). The base `fishaudio/drama-3` may differ (not tested: not downloaded).
   → Scene mode keeps the single-request `<|speaker:N|>` path (as planned, for models that can do it) but the UI warns, and offers **"per-line scene"**: each line is generated with its own cast voice, in order, and the result is concatenated with the lines' silences. This is the default for Drama-3-Japanese.
2. **Model names (`qwen3-asr-0.6b`, `irodori-tts-mf`) sometimes re-fetch** the file when speech.exe is started from another program (seen twice: the worker and `asr` printed `Fetching … checked its SHA-256` although the file was in the model folder). `speech pull NAME` answers in 30 ms with the path when it is there. → Voice Studio resolves a catalog name to its path with `speech pull` once and passes **paths** to every subcommand.
3. `speech voice` does not need the GPU or the worker to stop; it runs as a short-lived process beside the worker.
4. The worker refuses unknown members, so `Drama3Adapter` drops `speed`/`instructions`/`steps` and `IrodoriAdapter` drops `top_k`/`top_p`/`temperature`/`max_seconds`/`experts_on_cpu` before sending.

## Spike scripts

The throwaway clients used (Python, not part of the app) are described here so the measurements can be repeated:
- a worker client that waits for `ready`, sends `count_tokens`, a request with a bad member, N `synthesize` requests (writing the chunks to WAV), a `cancel` 0.3 s into a long request, and `info`;
- a wrapper that runs a subcommand and reads its `PeakWorkingSetSize` with `GetProcessMemoryInfo` after it exits.

## E2E results (release build, 2026-11-26)

Driven through the real GUI (`voice-studio.exe` release build) over the WebView2 DevTools protocol, and through the `real_engine` integration test (`cargo test --test real_engine`).

| Check | Result |
|---|---|
| Load Drama-3 Q4_K on Vulkan0 from the toolbar | ready in 5.7–6.7 s (file in the OS cache) |
| 3 lines with tags (typed, Enter for a new line, pasting 2 sentences auto-split them into 2 lines), 2 takes per line, sequential seeds 42/43 | 6 takes in 8.9 s; ASR of every take matches its text (the cues are acted, not read aloud) |
| Playback | `<audio>` via the asset protocol plays the takes (duration 4.88 s, currentTime advancing) |
| Voice from a reference WAV with automatic transcription | ASR 1.6 s (text correct), `speech voice` 3.3 s; generating with that voice works |
| 2-speaker scene, single request (`<|speaker:N|>`) | the cast voice is merged automatically (2 speakers); **only speaker 0 speaks** (known limitation, see above). Per-line scenes work |
| Combined WAV + SRT + txt export (pre 0.2 s / post 0.5 s) | SRT 0.200→5.076, 5.776→7.912, 8.612→11.585; WAV 12.085 s = Σ(pre+take+post); one WAV per line with the template `{index}_{cast}_{text8}`, a second export of the same name became `_2` |
| Save `.vsproj` → reopen | takes copied to `e2e.takes/`; the reopened project matches the saved one |
| Switch to Irodori-TTS-mf from the toolbar | ready in 4.7 s; the palette switches to emoji; `🤭ふふ、[笑い]そうなんだ。😮‍💨` + instructions + speed 1.2 → 48 kHz take; the `[笑い]` cue is stripped with a notice; a Drama-3 voice is flagged as not for this model |
| **GUI memory** (Drama-3 resident, after all of the above) | `voice-studio.exe` working set **28.7 MB** (private 6.7 MB). The WebView2 child processes are separate (renderer about 110–140 MB working set each, GPU process 143 MB) and `speech.exe` 113 MB working set (the model lives in VRAM) |
