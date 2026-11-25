// Copy / cut / paste of whole lines. The system clipboard gets `キャラ,テキスト` text (what txt import reads);
// pasting that same text back inside the app restores the lines with their options and silences.
import { parseScript, uid } from "../../lib/text";
import type { Cast, Line } from "../../lib/types";
import { useApp } from "../../store/app";
import { newCast, newLine, useProject } from "../../store/project";

let internal: { text: string; lines: Line[] } | null = null;

export function linesToText(lines: Line[], cast: Cast[]): string {
  return lines.map((l) => {
    const name = cast.find((c) => c.id === l.castId)?.name;
    return name ? `${name},${l.text}` : l.text;
  }).join("\n");
}

/** Lines for a paste: the copied lines (fresh ids, no takes) when the text is ours, else parsed `キャラ,テキスト`. */
export function linesFromClipboard(text: string, copied: { text: string; lines: Line[] } | null, cast: Cast[]): { lines: Line[]; newCast: Cast[] } {
  if (copied && copied.text === text) {
    return { lines: copied.lines.map((l) => ({ ...structuredClone(l), id: uid(), takes: [], selectedTakeId: null })), newCast: [] };
  }
  const added: Cast[] = [];
  const all = [...cast];
  const lines = parseScript(text).map((r) => {
    let c = r.castName ? all.find((x) => x.name === r.castName) : undefined;
    if (r.castName && !c) {
      c = newCast(r.castName, all.length);
      all.push(c);
      added.push(c);
    }
    return newLine({ castId: c?.id ?? null, text: r.text });
  });
  return { lines, newCast: added };
}

function selectedLines(): Line[] {
  const { project, selection, activeLineId } = useProject.getState();
  const ids = selection.length ? selection : activeLineId ? [activeLineId] : [];
  return project.lines.filter((l) => ids.includes(l.id));
}

export async function copyLines(cut = false) {
  const lines = selectedLines();
  if (!lines.length) return;
  const text = linesToText(lines, useProject.getState().project.cast);
  internal = { text, lines: structuredClone(lines) };
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* the internal copy still works */
  }
  if (cut) useProject.getState().removeLines(lines.map((l) => l.id));
  useApp.getState().notify("info", `${lines.length} 行を${cut ? "切り取り" : "コピー"}しました`);
}

export async function pasteLines() {
  let text = internal?.text ?? "";
  try {
    const t = await navigator.clipboard.readText();
    if (t) text = t;
  } catch {
    /* fall back to the internal copy */
  }
  if (!text.trim()) return;
  const st = useProject.getState();
  const { lines, newCast: added } = linesFromClipboard(text, internal, st.project.cast);
  if (!lines.length) return;
  const sel = st.selection.length ? st.selection : st.activeLineId ? [st.activeLineId] : [];
  const lastIdx = Math.max(-1, ...sel.map((id) => st.project.lines.findIndex((l) => l.id === id)));
  st.edit("行を貼り付け", (d) => {
    d.cast.push(...added);
    d.lines.splice(lastIdx < 0 ? d.lines.length : lastIdx + 1, 0, ...lines);
  });
  st.select(lines.map((l) => l.id), null);
}
