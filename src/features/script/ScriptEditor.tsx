// The script: a sortable list of lines, each with its cast, text and generation state.
import { memo, useCallback } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { LineEditor, LineText } from "./LineEditor";
import { applyPaste } from "../../lib/text";
import type { Cast, Line } from "../../lib/types";
import { newLine, useProject } from "../../store/project";
import { useApp } from "../../store/app";
import { usePlayer } from "../../lib/player";
import { generateIds, lineItems, session } from "../generate/actions";
import { PlayButton } from "../../app/PlayButton";
import { Icon } from "../../app/icons";
import { SelectionBar } from "./SelectionBar";

const PLACEHOLDER = "セリフを入力（[驚いて] などの演技タグ可）";

export function ScriptEditor() {
  const lines = useProject((s) => s.project.lines);
  const cast = useProject((s) => s.project.cast);
  const moveLine = useProject((s) => s.moveLine);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      if (!e.over || e.active.id === e.over.id) return;
      const to = useProject.getState().project.lines.findIndex((l) => l.id === e.over!.id);
      moveLine(String(e.active.id), to);
    },
    [moveLine],
  );

  return (
    <div className="script">
      <SelectionBar />
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={lines.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          {lines.map((l, i) => (
            <Row key={l.id} line={l} index={i} cast={cast} />
          ))}
        </SortableContext>
      </DndContext>
      <button
        className="add-line"
        onClick={() => {
          const s = useProject.getState();
          const last = s.project.lines[s.project.lines.length - 1];
          const nl = newLine({ castId: last?.castId ?? s.project.cast[0]?.id ?? null });
          s.addLines(last?.id ?? null, [nl]);
          s.select([nl.id], nl.id);
        }}
      >
        ＋ 行を追加
      </button>
    </div>
  );
}

const Row = memo(function Row({ line, index, cast }: { line: Line; index: number; cast: Cast[] }) {
  const active = useProject((s) => s.activeLineId === line.id);
  const selected = useProject((s) => s.selection.includes(line.id));
  // A string, so the row re-renders only when its own jobs change.
  const job = useApp((s) => {
    let n = 0;
    let status = "queued";
    let seconds = 0;
    for (const j of Object.values(s.jobs)) {
      if (j.lineId !== line.id) continue;
      n++;
      if (j.status === "running") {
        status = "running";
        seconds = j.seconds;
      }
    }
    return n ? `${status}:${seconds.toFixed(1)}:${n}` : "";
  });
  const playing = usePlayer((s) => s.playingKey === line.id || line.takes.some((t) => t.id === s.playingKey));
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: line.id });
  const c = cast.find((x) => x.id === line.castId);

  const onClick = (e: React.MouseEvent) => {
    const s = useProject.getState();
    const ids = s.project.lines.map((l) => l.id);
    if (e.shiftKey && s.activeLineId) {
      const a = ids.indexOf(s.activeLineId);
      const b = ids.indexOf(line.id);
      s.select(ids.slice(Math.min(a, b), Math.max(a, b) + 1), s.activeLineId);
    } else if (e.ctrlKey || e.metaKey) {
      s.select(selected ? s.selection.filter((x) => x !== line.id) : [...s.selection, line.id], line.id);
    } else if (!active) {
      s.select([line.id], line.id);
    }
  };

  const onEnter = (shift: boolean) => {
    const s = useProject.getState();
    const ls = s.project.lines;
    const i = ls.findIndex((l) => l.id === line.id);
    if (shift || i === ls.length - 1) {
      const nl = newLine({ castId: line.castId });
      s.addLines(line.id, [nl]);
      s.select([nl.id], nl.id);
    } else {
      s.select([ls[i + 1].id], ls[i + 1].id);
    }
  };

  const onArrow = (dir: -1 | 1) => {
    const s = useProject.getState();
    const ls = s.project.lines;
    const i = ls.findIndex((l) => l.id === line.id) + dir;
    if (i >= 0 && i < ls.length) s.select([ls[i].id], ls[i].id);
  };

  const onPaste = (from: number, to: number, text: string) => {
    const parts = applyPaste(line.text, from, to, text);
    if (parts.length <= 1) return false;
    const s = useProject.getState();
    s.edit("貼り付け", (d) => {
      const i = d.lines.findIndex((l) => l.id === line.id);
      d.lines[i].text = parts[0];
      d.lines.splice(i + 1, 0, ...parts.slice(1).map((t) => newLine({ castId: line.castId, text: t })));
    });
    return true;
  };

  const [status, secs, n] = job ? job.split(":") : [];
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      className={`row${active ? " active" : ""}${selected ? " selected" : ""}${playing ? " playing" : ""}`}
      onMouseDown={onClick}
    >
      <span className="drag" {...attributes} {...listeners} title="ドラッグで並べ替え">
        ⋮⋮
      </span>
      <span className="idx">{index + 1}</span>
      <select
        className="cast-select"
        style={{ borderColor: c?.color }}
        value={line.castId ?? ""}
        onChange={(e) => useProject.getState().updateLine(line.id, { castId: e.target.value || null }, "話者を変更")}
      >
        <option value="">（なし）</option>
        {cast.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
      <div className="text">
        {active ? (
          <LineEditor
            value={line.text}
            autoFocus
            placeholderText={PLACEHOLDER}
            onChange={(t) => useProject.getState().setLineText(line.id, t)}
            onEnter={onEnter}
            onArrow={onArrow}
            onPaste={onPaste}
          />
        ) : (
          <div className="line-static">
            <LineText text={line.text} placeholderText={PLACEHOLDER} />
          </div>
        )}
        {line.memo && <div className="memo">メモ: {line.memo}</div>}
      </div>
      <span className="state">
        {status === "running" && <span className="badge run">生成中 {secs}s</span>}
        {status === "queued" && <span className="badge wait">待機 {n}</span>}
        {status === "running" && Number(n) > 1 && <span className="badge wait">+{Number(n) - 1}</span>}
        {line.takes.length > 0 && <span className="badge takes" title="テイク数">{line.takes.length}</span>}
        {line.takes.some((t) => t.stopReason !== "complete") && <span className="badge warn" title="最大長で打ち切り">!</span>}
      </span>
      <span className="row-actions">
        <PlayButton className="icon" session={session.line(line.id)} items={() => lineItems(line.id)} disabled={!line.takes.length} />
        {job ? (
          <button className="icon" title="キャンセル" aria-label="キャンセル" onClick={() => void useApp.getState().cancelLine(line.id)}>
            <Icon name="stop" size={14} />
          </button>
        ) : (
          <button className="icon" title="この行を生成" aria-label="この行を生成" onClick={() => void generateIds([line.id])}>
            <Icon name="generate" size={14} />
          </button>
        )}
      </span>
    </div>
  );
});
