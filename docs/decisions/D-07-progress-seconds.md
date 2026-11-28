# D-07 Progress is shown as seconds generated

- **Status**: Accepted (2026-11-26)
- **Code**: `src-tauri/src/jobs/`, `src/app/StatusBar.tsx`

## Context

Drama-3 streams audio chunks but sends no `progress` fraction, and the length of the result is not known in advance.

## Decision

A running job shows the seconds of audio generated so far, not a percentage. The queue ETA is the mean time of the
last 20 finished jobs times the jobs left, minus the running job's elapsed time, and is shown only after the first job
finishes.
