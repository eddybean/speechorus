# D-37 Mineral Sage colors, a left rail and a slim top bar

- **Status**: Accepted (2026-11-26, the user picked pattern C of three); the rail's screens changed in D-54
- **Code**: `src/styles.css`, `src/app/TopBar.tsx`, `src/app/Rail.tsx`, `src/app/StatusBar.tsx`, `src/app/icons.tsx`

## Decision

- **Colors**: sage-tinted neutrals with one jade accent, `#4FC3A1` on `#121715` (dark) and `#0F6E5A` on `#EEF0EB`
  (light); tags in ochre. Colors are tokens in `src/styles.css` only, so dialogs follow.
- **Top bar**: the ファイル menu (with 編集), the project name with an unsaved mark, a 生成 split button (▾: 未生成/全行,
  takes per line, seed), 連続再生/停止, the volume (D-46) and 書き出し.
- **Left rail**: the screens and the cast panel toggle (D-54), with エンジン and 設定 at the bottom. When the chosen
  profile has no model, the エンジン panel's main button and the status bar offer モデルを入手… instead of a start that
  would only fail.
- **Selection bar** above the script when two or more lines are selected; **status bar** for the queue and the loaded
  model.
- Line icons (`icons.tsx`) instead of emoji in the main window. Shortcut hints show ⌘ on macOS, Ctrl+ elsewhere.

## Consequences

New UI should use the tokens and the icon set rather than new colors or emoji. Pasting lines has no button; it is
Ctrl/⌘+V or the context menu (D-48).
