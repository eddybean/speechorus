// The app's own right-click menu, in place of the WebView's (戻る / 再読み込み / 印刷 / 検証…, D-48).
// Text fields get Undo/Redo and clipboard items; script lines get line actions; elsewhere no menu opens.
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { EditorView } from "@codemirror/view";
import { MenuItem } from "./Menu";
import { newLine, useProject } from "../store/project";
import { createScene, generateIds } from "../features/generate/actions";
import { copyLines, pasteLines } from "../features/script/clipboard";

export type TextField = HTMLInputElement | HTMLTextAreaElement;

/** Input types that hold text a user edits (not checkboxes, ranges, colors…). */
const TEXT_INPUTS = new Set(["text", "search", "url", "tel", "email", "number", "password", ""]);

export interface MenuTarget {
  /** The text field or CodeMirror editor under the pointer. */
  field: TextField | EditorView | null;
  /** The script line under the pointer. */
  lineId: string | null;
  /** Text selected outside any field (log output, for example). */
  selectedText: string;
}

export function menuTarget(el: Element | null, selectedText = ""): MenuTarget {
  let field: MenuTarget["field"] = null;
  const cm = el?.closest(".cm-editor");
  if (cm instanceof HTMLElement) field = EditorView.findFromDOM(cm);
  else if (el instanceof HTMLTextAreaElement) field = el;
  else if (el instanceof HTMLInputElement && TEXT_INPUTS.has(el.type)) field = el;
  const row = el?.closest<HTMLElement>("[data-line-id]");
  return { field, lineId: row?.dataset.lineId ?? null, selectedText: field ? "" : selectedText };
}

export function hasMenu(t: MenuTarget): boolean {
  return !!(t.field || t.lineId || t.selectedText);
}

function fieldSelection(f: TextField | EditorView): string {
  if (f instanceof EditorView) {
    const { from, to } = f.state.selection.main;
    return f.state.sliceDoc(from, to);
  }
  try {
    return f.value.slice(f.selectionStart ?? 0, f.selectionEnd ?? 0);
  } catch {
    return ""; // number inputs have no selection API
  }
}

function readOnly(f: TextField | EditorView): boolean {
  return f instanceof EditorView ? f.state.readOnly : f.readOnly || f.disabled;
}

async function pasteInto(f: TextField | EditorView) {
  let text = "";
  try {
    text = await navigator.clipboard.readText();
  } catch {
    return;
  }
  if (!text) return;
  if (f instanceof EditorView) {
    f.focus();
    // Through the editor's own paste handling, so a multi-line paste splits into lines as with Ctrl+V.
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    if (f.contentDOM.dispatchEvent(ev)) f.dispatch(f.state.replaceSelection(text.replace(/\r?\n/g, " ")));
  } else {
    f.focus();
    // execCommand keeps the field's own undo and fires the input event React listens for.
    if (!document.execCommand("insertText", false, text))
      f.setRangeText(text, f.selectionStart ?? 0, f.selectionEnd ?? 0, "end");
  }
}

function selectAll(f: TextField | EditorView) {
  f.focus();
  if (f instanceof EditorView) f.dispatch({ selection: { anchor: 0, head: f.state.doc.length } });
  else f.select();
}

export function ContextMenu() {
  const [open, setOpen] = useState<{ x: number; y: number; target: MenuTarget } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMenu = (e: MouseEvent) => {
      // Shift+right-click in a dev build still opens the WebView's menu, for 検証 (DevTools).
      if (import.meta.env.DEV && e.shiftKey) return;
      e.preventDefault();
      const target = menuTarget(e.target instanceof Element ? e.target : null, String(window.getSelection() ?? ""));
      setPos(null);
      setOpen(hasMenu(target) ? { x: e.clientX, y: e.clientY, target } : null);
    };
    window.addEventListener("contextmenu", onMenu);
    return () => window.removeEventListener("contextmenu", onMenu);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    const onDown = (e: MouseEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("wheel", close, { passive: true });
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("wheel", close);
    };
  }, [open]);

  // Keep the menu inside the window: flip it left of / above the pointer when it would run off.
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    const left = open.x + width > window.innerWidth - 4 ? Math.max(4, open.x - width) : open.x;
    const top = open.y + height > window.innerHeight - 4 ? Math.max(4, open.y - height) : open.y;
    setPos({ left, top });
  }, [open]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      className="popover context-menu"
      role="menu"
      style={{ left: pos?.left ?? open.x, top: pos?.top ?? open.y, visibility: pos ? "visible" : "hidden" }}
      // Keep focus and the text selection in the field the menu acts on.
      onMouseDown={(e) => e.preventDefault()}
    >
      <ContextItems target={open.target} close={() => setOpen(null)} />
    </div>
  );
}

function ContextItems({ target, close }: { target: MenuTarget; close: () => void }) {
  const canUndo = useProject((s) => s.undoStack.length > 0);
  const canRedo = useProject((s) => s.redoStack.length > 0);
  const selection = useProject((s) => s.selection);
  const run = (f: () => void) => () => {
    close();
    f();
  };
  const groups: ReactNode[] = [];
  const { field, lineId, selectedText } = target;

  if (field || lineId) {
    groups.push(
      <>
        <MenuItem icon="undo" kbd="Ctrl+Z" disabled={!canUndo} onSelect={run(() => useProject.getState().undo())}>
          元に戻す
        </MenuItem>
        <MenuItem icon="redo" kbd="Ctrl+Y" disabled={!canRedo} onSelect={run(() => useProject.getState().redo())}>
          やり直し
        </MenuItem>
      </>,
    );
  }

  if (field) {
    const sel = fieldSelection(field) !== "";
    const ro = readOnly(field);
    groups.push(
      <>
        <MenuItem kbd="Ctrl+X" disabled={!sel || ro} onSelect={run(() => document.execCommand("cut"))}>
          切り取り
        </MenuItem>
        <MenuItem icon="copy" kbd="Ctrl+C" disabled={!sel} onSelect={run(() => document.execCommand("copy"))}>
          コピー
        </MenuItem>
        <MenuItem kbd="Ctrl+V" disabled={ro} onSelect={run(() => void pasteInto(field))}>
          貼り付け
        </MenuItem>
        <MenuItem kbd="Ctrl+A" onSelect={run(() => selectAll(field))}>
          すべて選択
        </MenuItem>
      </>,
    );
  } else if (selectedText) {
    groups.push(
      <MenuItem
        icon="copy"
        kbd="Ctrl+C"
        onSelect={run(() => void navigator.clipboard.writeText(selectedText).catch(() => {}))}
      >
        コピー
      </MenuItem>,
    );
  }

  if (lineId) {
    const ids = selection.includes(lineId) ? selection : [lineId];
    const many = ids.length > 1;
    const p = useProject.getState;
    groups.push(
      <>
        <MenuItem icon="generate" kbd="Ctrl+Enter" onSelect={run(() => void generateIds(ids))}>
          {many ? `${ids.length} 行を生成` : "この行を生成"}
        </MenuItem>
        {many && (
          <MenuItem icon="scene" onSelect={run(() => createScene(ids))}>
            シーンにまとめる
          </MenuItem>
        )}
        <MenuItem
          icon="plus"
          onSelect={run(() => {
            const s = p();
            const line = s.project.lines.find((l) => l.id === lineId);
            const nl = newLine({ castId: line?.castId ?? null });
            s.addLines(lineId, [nl]);
            s.select([nl.id], nl.id);
          })}
        >
          下に行を追加
        </MenuItem>
      </>,
      <>
        <MenuItem onSelect={run(() => void copyLines(true))}>{many ? "行を切り取り" : "この行を切り取り"}</MenuItem>
        <MenuItem icon="copy" onSelect={run(() => void copyLines())}>
          {many ? "行をコピー" : "この行をコピー"}
        </MenuItem>
        <MenuItem onSelect={run(() => void pasteLines())}>行を下に貼り付け</MenuItem>
        <MenuItem icon="duplicate" kbd="Ctrl+D" onSelect={run(() => p().duplicateLines(ids))}>
          複製
        </MenuItem>
      </>,
      <MenuItem icon="trash" kbd="Delete" onSelect={run(() => p().removeLines(ids))}>
        {many ? `${ids.length} 行を削除` : "この行を削除"}
      </MenuItem>,
    );
  }

  return groups.map((g, i) => (
    <Fragment key={i}>
      {i > 0 && <hr />}
      {g}
    </Fragment>
  ));
}
