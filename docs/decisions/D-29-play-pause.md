# D-29 Play buttons pause and resume

- **Status**: Accepted (2026-11-26, the user changed stop to pause)
- **Code**: `src/lib/player.ts`

## Decision

Every play button (line, take, continuous playback, scene, references, voice list, design candidates, range preview):

- ▶ plays; pressing it while playing pauses; pressing it again resumes from the same point (a highlighted ▶, tooltip
  再開). At the end it returns to ▶ and the next press starts over.
- Starting a different playback stops the previous one and drops its position.
- Continuous playback resumes on the same line and goes on; a pause in the silence between lines resumes with the
  rest of that silence (the gap after one line and before the next is one pausable wait).
- 停止 beside 連続再生 stops and goes back to the start. Space toggles pause/resume, or plays the active line when
  nothing is playing.

## Alternatives not taken

- Stop only (the first version): the user wanted to resume long takes from the middle.
