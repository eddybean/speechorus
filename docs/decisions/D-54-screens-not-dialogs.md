# D-54 ボイス and モデル are screens of the main pane, not dialogs

- **Status**: Accepted (2026-11-28, user decision); changes the rail of D-37
- **Code**: `src/app/Rail.tsx`, `src/app/Page.tsx`, `src/app/App.tsx`, `src/store/app.ts` (`view`)

## Context

The rail opened the voice library and the model manager as modals. The user found that out of place for a sidebar,
and Esc or a click on the backdrop threw away references being prepared.

## Decision

- The rail's top group (台本, ボイス, モデル) switches the main pane (`aria-current="page"`, a jade bar). Below a
  separator, キャスト toggles the cast panel; pressed on another screen it returns to the script with the panel shown.
- ボイス and モデル are `Page`s with no close button. Each is mounted on first visit and then kept hidden, so trimming,
  transcription, a voice being designed or the chosen profile survive going back to the script. The モデル screen
  reads the devices again each time it is shown.
- 設定, 書き出し and モデルを入手 (the catalog) stay dialogs.
- Ctrl/⌘+S, O and Space work on every screen. Line shortcuts (Undo/Redo, line copy/cut/paste, duplicate, Delete,
  Ctrl/⌘+Enter, Esc) work only while the script is on screen, so they cannot change lines the user cannot see.

## Alternatives not taken

- Keeping modals: rails (Material 3 Navigation Rail, Apple HIG sidebars, VS Code, Slack, Teams) switch between
  top-level destinations, and a modal suits a short task, not a work area.
- Settings as a screen too: it is small, and apps differ there (Slack and Notion use a modal).

## Consequences

A new top-level work area should be a screen on the rail; a short task a dialog.
