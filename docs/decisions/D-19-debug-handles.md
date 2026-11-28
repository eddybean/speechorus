# D-19 Debug handles for E2E: `window.__speechorus` and `vs-add-refs`

- **Status**: Accepted (2026-11-26); includes the former D-35
- **Code**: `src/main.tsx`, `src/features/voices/`

## Context

The app is tested end to end by driving the WebView2 DevTools protocol. Native file dialogs cannot be driven from a
script, and some state is hard to reach through the UI alone.

## Decision

- `window.__speechorus` exposes the stores and actions.
- The window event `vs-add-refs` adds reference audio to the voice library by path (once the ボイス screen has been
  opened, since D-54).

## Consequences

Both are reachable only from inside the WebView. DevTools is disabled in release builds unless an environment
variable enables it, so users are not exposed. Keep these working when refactoring the stores or the voice screen.
