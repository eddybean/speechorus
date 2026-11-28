# D-34 Voice-design candidates are checked by ASR before fixing

- **Status**: Accepted (2026-11-26)
- **Code**: `src/features/voices/`

## Context

Voice design makes N candidates from a description and a sample sentence (consecutive seeds); "この声で固定" then runs
`speech voice` on the chosen WAV with the sample sentence (cues removed) as its transcript. In testing, one Drama-3
candidate stopped before the last clause of the sentence. Fixing it would give a voice whose transcript and audio
disagree.

## Decision

Each candidate is transcribed by ASR after it is generated. A candidate that looks unfinished is marked
"⚠ 読み切れていない可能性", and fixing it asks for confirmation. The transcript is still the sample sentence; ASR only
warns. The check passes at an LCS of 75% or more plus a match of the last two characters, because ASR may write kana
as kanji (頑張り for がんばり).

## Consequences

Each candidate costs about 1 s of ASR. Irodori uses the same UI but needs no transcript.
