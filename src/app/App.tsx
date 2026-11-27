import { useEffect, useState } from "react";
import { useApp, type View } from "../store/app";
import { useProject } from "../store/project";
import { TopBar } from "./TopBar";
import { Rail } from "./Rail";
import { StatusBar } from "./StatusBar";
import { ContextMenu } from "./ContextMenu";
import { ScriptEditor } from "../features/script/ScriptEditor";
import { CastPanel } from "../features/cast/CastPanel";
import { Inspector } from "../features/takes/Inspector";
import { VoiceLibrary } from "../features/voices/VoiceLibrary";
import { ModelManager } from "../features/models/ModelManager";
import { ExportDialog } from "../features/export/ExportDialog";
import { SettingsDialog } from "../features/settings/SettingsDialog";
import { CatalogDialog } from "../features/models/CatalogDialog";
import { generateSelected, togglePlay } from "../features/generate/actions";
import { openProject, saveProject } from "../features/project/fileOps";
import { copyLines, pasteLines } from "../features/script/clipboard";
import { activeEditor } from "../features/script/LineEditor";

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}

/** Ctrl+C/X/V act on whole lines when several lines are selected, or when no text field has focus. */
function lineClipboardMode(e: KeyboardEvent, selected: number): boolean {
  // A plain form field (such as the seed box) keeps its own copy and paste.
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return false;
  if (selected > 1) {
    const v = activeEditor();
    return !v || v.state.selection.main.empty;
  }
  return !isTyping(e) && (selected > 0 || e.key.toLowerCase() === "v");
}

export function App() {
  const ready = useApp((s) => s.ready);
  const dialog = useApp((s) => s.dialog);
  const notices = useApp((s) => s.notices);
  const castOpen = useApp((s) => s.castOpen);
  const view = useApp((s) => s.view);
  // A screen is mounted on its first visit and then kept, hidden, so that work in progress there (references
  // being trimmed, a profile being edited) survives going back to the script (D-54).
  const [visited, setVisited] = useState<ReadonlySet<View>>(() => new Set([view]));
  if (!visited.has(view)) setVisited(new Set(visited).add(view));

  useEffect(() => {
    void useApp.getState().init();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const p = useProject.getState();
      // Shortcuts on lines (undo, copy, delete…) work only while the script is on screen.
      const onScript = useApp.getState().view === "script";
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveProject(e.shiftKey);
      } else if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void openProject();
      } else if (e.key === " " && !isTyping(e)) {
        e.preventDefault();
        togglePlay();
      } else if (!onScript) {
        return;
      } else if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        p.undo();
      } else if (mod && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
        e.preventDefault();
        p.redo();
      } else if (mod && e.key === "Enter") {
        e.preventDefault();
        void generateSelected();
      } else if (mod && ["c", "x", "v"].includes(e.key.toLowerCase()) && lineClipboardMode(e, p.selection.length)) {
        e.preventDefault();
        const k = e.key.toLowerCase();
        if (k === "v") void pasteLines();
        else void copyLines(k === "x");
      } else if (mod && e.key.toLowerCase() === "d" && p.selection.length) {
        e.preventDefault();
        p.duplicateLines(p.selection);
      } else if (e.key === "Delete" && !isTyping(e) && p.selection.length) {
        e.preventDefault();
        p.removeLines(p.selection);
      } else if (e.key === "Escape" && !isTyping(e)) {
        p.select([], null);
      }
    };
    window.addEventListener("keydown", onKey);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (useProject.getState().dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);

  if (!ready) return <div className="loading">Speechorus を起動しています…</div>;
  return (
    <div className="app">
      <TopBar />
      <div className="workspace">
        <Rail />
        <main className={`main${castOpen ? "" : " no-cast"}`} hidden={view !== "script"}>
          {castOpen && <CastPanel />}
          <ScriptEditor />
          <Inspector />
        </main>
        {visited.has("voices") && (
          <div className="page-host" hidden={view !== "voices"}>
            <VoiceLibrary />
          </div>
        )}
        {visited.has("models") && (
          <div className="page-host" hidden={view !== "models"}>
            <ModelManager />
          </div>
        )}
      </div>
      <StatusBar />
      <div className="notices">
        {notices.map((n) => (
          <div key={n.id} className={`notice ${n.kind}`} onClick={() => useApp.getState().dismiss(n.id)}>
            {n.text}
          </div>
        ))}
      </div>
      {dialog === "export" && <ExportDialog />}
      {dialog === "settings" && <SettingsDialog />}
      {dialog === "catalog" && <CatalogDialog />}
      <ContextMenu />
    </div>
  );
}
