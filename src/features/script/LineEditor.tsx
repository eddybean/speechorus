// A single-line CodeMirror 6 editor that highlights [cues], <|speaker:N|> and emoji tags.
import { useEffect, useRef } from "react";
import { Annotation, EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, placeholder, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { tokenize } from "../../lib/text";

const external = Annotation.define<boolean>();

const marks = {
  tag: Decoration.mark({ class: "tok-tag" }),
  speaker: Decoration.mark({ class: "tok-speaker" }),
  emoji: Decoration.mark({ class: "tok-emoji" }),
};

function decorate(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  for (const t of tokenize(view.state.doc.toString())) {
    if (t.kind !== "text") b.add(t.from, t.to, marks[t.kind]);
  }
  return b.finish();
}

const highlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(v: EditorView) {
      this.decorations = decorate(v);
    }
    update(u: ViewUpdate) {
      if (u.docChanged) this.decorations = decorate(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

/** The editor that has focus, so the tag palette can insert at its cursor. */
let activeView: EditorView | null = null;
export function activeEditor(): EditorView | null {
  return activeView && activeView.dom.isConnected ? activeView : null;
}

/** Inserts text at the active editor's cursor (replacing its selection). Returns false without one. */
export function insertAtCursor(text: string): boolean {
  const v = activeEditor();
  if (!v) return false;
  const { from, to } = v.state.selection.main;
  // Do not split an existing tag.
  let at = from;
  for (const t of tokenize(v.state.doc.toString())) if (t.kind !== "text" && t.from < at && at < t.to) at = t.to;
  v.dispatch({ changes: { from: at, to: at === from ? to : at, insert: text }, selection: { anchor: at + text.length }, scrollIntoView: true });
  v.focus();
  return true;
}

export interface LineEditorProps {
  value: string;
  autoFocus?: boolean;
  placeholderText?: string;
  onChange: (text: string) => void;
  onEnter: (shift: boolean) => void;
  onArrow: (dir: -1 | 1) => void;
  onPaste: (from: number, to: number, text: string) => boolean;
  onFocus?: () => void;
}

export function LineEditor(props: LineEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cb = useRef(props);
  cb.current = props;

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: props.value,
        extensions: [
          highlighter,
          EditorView.lineWrapping,
          placeholder(props.placeholderText ?? ""),
          EditorState.transactionFilter.of((tr) => (tr.docChanged && tr.newDoc.lines > 1 ? [] : tr)),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((t) => t.annotation(external))) cb.current.onChange(u.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            focus: (_e, v) => {
              activeView = v;
              cb.current.onFocus?.();
            },
            keydown: (e, v) => {
              if (e.key === "Enter" && !e.isComposing) {
                e.preventDefault();
                cb.current.onEnter(e.shiftKey);
                return true;
              }
              if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.isComposing) {
                const sel = v.state.selection.main;
                const atEdge = e.key === "ArrowUp" ? sel.head === 0 || !v.lineWrapping : sel.head === v.state.doc.length || !v.lineWrapping;
                if (atEdge) {
                  e.preventDefault();
                  cb.current.onArrow(e.key === "ArrowUp" ? -1 : 1);
                  return true;
                }
              }
              return false;
            },
            paste: (e, v) => {
              const text = e.clipboardData?.getData("text/plain") ?? "";
              const { from, to } = v.state.selection.main;
              if (cb.current.onPaste(from, to, text)) {
                e.preventDefault();
                return true;
              }
              return false;
            },
          }),
        ],
      }),
    });
    view.current = v;
    if (props.autoFocus) {
      v.focus();
      v.dispatch({ selection: { anchor: v.state.doc.length } });
    }
    return () => {
      if (activeView === v) activeView = null;
      v.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== props.value) {
      const head = Math.min(v.state.selection.main.head, props.value.length);
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: props.value }, selection: { anchor: head }, annotations: external.of(true) });
    }
  }, [props.value]);

  return <div className="line-editor" ref={host} />;
}

/** The highlighted, non-editable form of a line, used for every line but the active one. */
export function LineText({ text, placeholderText }: { text: string; placeholderText?: string }) {
  if (!text) return <span className="line-placeholder">{placeholderText}</span>;
  return (
    <>
      {tokenize(text).map((t, i) => (
        <span key={i} className={t.kind === "text" ? undefined : `tok-${t.kind}`}>
          {t.text}
        </span>
      ))}
    </>
  );
}
