# D-25 How model downloads resume, verify, recommend and ask for consent

- **Status**: Accepted (2026-11-26); includes the former D-24 and D-26; the `speechPull` part is D-59
- **Code**: `src-tauri/src/downloads.rs`, `src/features/models/`

## Decision

**Hugging Face downloads** (Drama-3):

- Files are written to `.part` and resumed with `Range: bytes=N-`. On resume the existing part is hashed first, so the
  final SHA-256 covers the whole file (about 1 s per GB). A server that ignores Range (small non-LFS files such as
  `.gguf.json`) gets a fresh download. Requests ask for `Accept-Encoding: identity` (D-56).
- Sidecars are fetched first. A matching file already in the destination is SHA-checked and kept.
- The free-space check requires the remaining bytes + 1 GiB. A SHA mismatch deletes the `.part` and shows an error.
- Default destination: `%LOCALAPPDATA%\dev.speechorus.app\models\<model id>` (changeable).
- A finished synthesis model gets the profile `<model id>-<variant>` (replacing one with the same id), which is
  selected; Drama-3 profiles get the three `GGML_VK_DISABLE_*` env vars and `Vulkan0`. A finished ASR model becomes the
  transcription model.

**Quantization choice**: the catalog default (Drama-3: Q4_K) is preselected. Separately, the largest supported variant
whose estimated VRAM fits the free memory (or the total minus 1 GiB while the engine is loaded) is marked 推奨. When
nothing fits, the smallest supported one is. Unsupported variants (IQ3_XXS on Vulkan) are never recommended.

**License consent** is a checkbox ticked for each download and not stored. The Rust side refuses a request without
`licenseAccepted`.

## Alternatives not taken

- Preselecting the recommended variant: the catalog default is the tested configuration; the mark only informs.
- Remembering consent: the license may change between downloads, and asking costs one click.

## Consequences

With 24 GB of VRAM Q4_K is recommended, and some experts may spill to the CPU. Users agree again on every download.
