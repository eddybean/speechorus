// Searchable, categorized acting-tag palette for the active model.
import { useMemo, useState } from "react";
import drama3 from "../../../assets/tags/drama3.json";
import irodori from "../../../assets/tags/irodori-emoji.json";
import { normalizeTag, insertTag } from "../../lib/text";
import type { TagPaletteData } from "../../lib/types";
import { useApp } from "../../store/app";
import { useProject } from "../../store/project";
import { insertAtCursor } from "../script/LineEditor";

const PALETTES: Record<string, TagPaletteData> = { drama3: drama3 as TagPaletteData, "irodori-emoji": irodori as TagPaletteData };

interface Item {
  value: string;
  label: string;
  help: string;
}

function items(p: TagPaletteData, catId: string, showNsfw: boolean): Item[] {
  return p.categories
    .filter((c) => (catId === "*" || c.id === catId) && (showNsfw || !c.nsfw))
    .flatMap((c) => c.tags.map((t) => (typeof t === "string" ? { value: t, label: t, help: "" } : { value: t.tag, label: t.label, help: t.help })));
}

export function insertTagEverywhere(tag: string) {
  if (insertAtCursor(tag)) return;
  // No editor has focus: append to the active line.
  const s = useProject.getState();
  const l = s.project.lines.find((x) => x.id === s.activeLineId);
  if (!l) return;
  const r = insertTag(l.text, l.text.length, l.text.length, tag);
  s.setLineText(l.id, r.text);
}

export function TagPalette() {
  const adapter = useApp((s) => s.activeAdapter());
  const settings = useApp((s) => s.settings);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("*");
  const [free, setFree] = useState("");
  const palette = PALETTES[adapter?.capabilities.tagPalette ?? "drama3"] ?? PALETTES.drama3;
  const syntax = palette.syntax;
  const showNsfw = !!settings?.showNsfwTags;
  const list = useMemo(() => {
    const all = items(palette, cat, showNsfw);
    const qq = q.trim();
    return qq ? all.filter((i) => i.value.includes(qq) || i.label.includes(qq) || i.help.includes(qq)) : all;
  }, [palette, cat, showNsfw, q]);

  const use = (raw: string) => {
    const tag = normalizeTag(raw, syntax);
    if (!tag) return;
    insertTagEverywhere(tag);
    const s = useApp.getState().settings;
    if (s) {
      const recent = [tag, ...s.recentTags.filter((t) => t !== tag)].slice(0, 12);
      void useApp.getState().saveSettings({ ...s, recentTags: recent });
    }
  };

  const recent = (settings?.recentTags ?? []).filter((t) => (syntax === "emoji" ? !t.startsWith("[") : t.startsWith("[")));
  return (
    <div className="palette">
      <div className="palette-head">
        <input placeholder="タグを検索" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="*">すべて</option>
          {palette.categories
            .filter((c) => showNsfw || !c.nsfw)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
        </select>
      </div>
      {recent.length > 0 && (
        <div className="tags recent">
          <span className="muted">最近:</span>
          {recent.map((t) => (
            <button key={t} className="tag" onMouseDown={(e) => e.preventDefault()} onClick={() => use(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
      <div className="tags">
        {list.map((i) => (
          <button
            key={i.value}
            className={`tag${syntax === "emoji" ? " emoji" : ""}`}
            title={i.help ? `${i.label}: ${i.help}` : i.label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => use(i.value)}
          >
            {syntax === "emoji" ? `${i.value} ${i.label}` : i.value}
          </button>
        ))}
        {list.length === 0 && <span className="muted">該当なし</span>}
      </div>
      <form
        className="palette-free"
        onSubmit={(e) => {
          e.preventDefault();
          use(free);
          setFree("");
        }}
      >
        <input placeholder={syntax === "emoji" ? "絵文字を入力" : "自由入力（例: 寂しそうに）"} value={free} onChange={(e) => setFree(e.target.value)} onMouseDown={(e) => e.stopPropagation()} />
        <button type="submit" onMouseDown={(e) => e.preventDefault()}>
          挿入
        </button>
      </form>
    </div>
  );
}
