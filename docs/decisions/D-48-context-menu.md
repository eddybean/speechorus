# D-48 The app's own right-click menu; no text selection outside fields

- **Status**: Accepted (2026-11-28)
- **Code**: `src/app/ContextMenu.tsx`, `src/styles.css`

## Context

Right-click opened the WebView's menu (戻る / 再読み込み / 印刷 / 検証…), which does not belong in a desktop app, and
dragging across the UI selected labels and buttons like a web page.

## Decision

- The WebView menu is replaced by the app's own, opened only where it has something to offer: text fields (元に戻す /
  やり直し, 切り取り / コピー / 貼り付け / すべて選択), script lines (生成, シーンにまとめる, 下に行を追加, line cut / copy /
  paste, 複製, 削除, on the whole selection when the line is in it) and selected text elsewhere (コピー). Elsewhere
  nothing opens. 元に戻す / やり直し are the project's Undo/Redo. In a dev build Shift+right-click still opens the
  WebView menu, for 検証.
- `user-select: none` on the body. Text fields, the CodeMirror editor, the engine log (`pre.log`), paths (`.path`) and
  anything marked `.selectable` stay selectable.

## Consequences

Text in labels and messages cannot be copied unless marked `.selectable`; add the class to anything a user may want
to copy (error details, paths). Spell-check suggestions from the WebView menu are gone.
