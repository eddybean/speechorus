// The right panel: the active line's settings and takes, and the scenes.
import { useState } from "react";
import { parseSeed } from "../../lib/text";
import { usePlayer } from "../../lib/player";
import type { Line, Take } from "../../lib/types";
import { useApp } from "../../store/app";
import { selectedTake, useProject } from "../../store/project";
import { copySeed, generateIds, generateScene, lineItems, rerollTake, sceneItems, session } from "../generate/actions";
import { PlayButton } from "../../app/PlayButton";
import { Icon } from "../../app/icons";
import { OptionForm } from "../models/OptionForm";
import { TagPalette } from "../tags/TagPalette";

export function Inspector() {
  const line = useProject((s) => s.project.lines.find((l) => l.id === s.activeLineId));
  return (
    <aside className="inspector">
      <section>
        <h3>演技タグ</h3>
        <TagPalette />
      </section>
      {line ? <LinePanel line={line} /> : <p className="muted pad">行を選択してください</p>}
      <Scenes />
    </aside>
  );
}

function LinePanel({ line }: { line: Line }) {
  const adapter = useApp((s) => s.activeAdapter());
  const cast = useProject((s) => s.project.cast.find((c) => c.id === line.castId));
  const upd = (patch: Partial<Line>, label?: string) => useProject.getState().updateLine(line.id, patch, label);
  return (
    <>
      <section>
        <h3>
          テイク <span className="muted">({line.takes.length})</span>
          <button className="small" onClick={() => void generateIds([line.id])}>
            <Icon name="generate" size={14} />
            生成
          </button>
        </h3>
        <SeedBox lineId={line.id} />
        <TakeList line={line} />
      </section>
      <section>
        <h3>行の設定</h3>
        <div className="grid2">
          <label>
            前の無音 (秒)
            <input type="number" step={0.05} min={0} value={line.preSilence} onChange={(e) => upd({ preSilence: Number(e.target.value) }, "無音")} />
          </label>
          <label>
            後の無音 (秒)
            <input type="number" step={0.05} min={0} value={line.postSilence} onChange={(e) => upd({ postSilence: Number(e.target.value) }, "無音")} />
          </label>
        </div>
        <label className="block">
          メモ
          <input type="text" value={line.memo} onChange={(e) => upd({ memo: e.target.value }, "メモ")} />
        </label>
        {adapter && (
          <details>
            <summary>この行だけのオプション</summary>
            <OptionForm
              specs={adapter.options}
              values={line.optionsOverride}
              inherited={cast?.defaultOptions}
              onChange={(name, v) => {
                const o = { ...line.optionsOverride };
                if (v === null) delete o[name];
                else o[name] = v;
                upd({ optionsOverride: o }, "オプション");
              }}
            />
          </details>
        )}
      </section>
    </>
  );
}

/** Generates one take of the line with a seed typed or pasted in (e.g. copied from a take's 🎲). */
function SeedBox({ lineId }: { lineId: string }) {
  // Kept while moving between lines, so one seed can be tried on several lines.
  const [text, setText] = useState("");
  const seed = parseSeed(text);
  const bad = text.trim() !== "" && seed === null;
  const go = () => {
    if (seed !== null) void rerollTake(lineId, seed);
  };
  return (
    <div className="seed-box">
      <input
        type="text"
        inputMode="numeric"
        className={bad ? "invalid" : ""}
        aria-label="シード値"
        placeholder="🎲 シードを貼り付け"
        title={bad ? "シードは0以上の整数です" : "テイクの 🎲 をクリックでコピーしたシードを貼り付けて生成"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") go();
        }}
      />
      <button className="small" disabled={seed === null} onClick={go} title="このシードで1テイク生成">
        <Icon name="generate" size={14} />
        このシードで生成
      </button>
    </div>
  );
}

function TakeList({ line }: { line: Line }) {
  const playingKey = usePlayer((s) => s.playingKey);
  const sel = selectedTake(line);
  if (!line.takes.length) return <p className="muted">まだテイクがありません</p>;
  const st = useProject.getState;
  // The file stays until the project is saved (Undo can bring the take back); orphans are pruned on save.
  const remove = (t: Take) => st().removeTake(line.id, t.id);
  return (
    <ul className="takes">
      {[...line.takes].reverse().map((t, i) => (
        <li key={t.id} className={`${t.id === sel?.id ? "adopted" : ""}${playingKey === t.id ? " playing" : ""}`}>
          <PlayButton session={session.take(t.id)} items={() => lineItems(line.id, t.id)} />
          <span className="take-name">#{line.takes.length - i}</span>
          <span className="muted take-dur">{t.duration.toFixed(1)}s</span>
          <button
            className="ghost muted take-seed"
            title={t.seed === null ? "シード不明" : `シード ${t.seed}（クリックでコピー）`}
            aria-label="シードをコピー"
            onClick={() => void copySeed(t.seed)}
          >
            🎲{t.seed ?? "?"}
          </button>
          {t.stopReason !== "complete" && (
            <span className="badge warn" title={t.stopReason}>
              打切
            </span>
          )}
          <span className="spacer" />
          <button title="お気に入り" className={t.starred ? "star on" : "star"} onClick={() => st().updateTake(line.id, t.id, { starred: !t.starred })}>
            {t.starred ? "★" : "☆"}
          </button>
          <button title="採用" className={t.id === sel?.id ? "on" : ""} onClick={() => st().updateLine(line.id, { selectedTakeId: t.id }, "テイクを採用")}>
            採用
          </button>
          <button title="同じシードで再生成" onClick={() => rerollTake(line.id, t.seed)}>
            ↻
          </button>
          <button className="icon" title="削除" aria-label="テイクを削除" onClick={() => remove(t)}>
            <Icon name="trash" size={14} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function Scenes() {
  const scenes = useProject((s) => s.project.scenes);
  const lines = useProject((s) => s.project.lines);
  const adapter = useApp((s) => s.activeAdapter());
  if (!scenes.length) return null;
  return (
    <section>
      <h3>シーン</h3>
      <ul className="scenes">
        {scenes.map((sc) => {
          const n = sc.lineIds.length;
          const first = lines.findIndex((l) => l.id === sc.lineIds[0]) + 1;
          return (
            <li key={sc.id}>
              <div className="scene-head">
                <input
                  value={sc.name}
                  onChange={(e) =>
                    useProject.getState().edit(
                      "シーン名",
                      (d) => {
                        const x = d.scenes.find((y) => y.id === sc.id);
                        if (x) x.name = e.target.value;
                      },
                      `scene:${sc.id}`,
                    )
                  }
                />
                <span className="muted">
                  {first}行目〜 {n}行
                </span>
              </div>
              <div className="scene-actions">
                <select
                  value={sc.mode}
                  onChange={(e) =>
                    useProject.getState().edit("シーンモード", (d) => {
                      const x = d.scenes.find((y) => y.id === sc.id);
                      if (x) x.mode = e.target.value as "single" | "perLine";
                    })
                  }
                >
                  <option value="perLine">行ごと（各キャストのボイス）</option>
                  <option value="single" disabled={!adapter?.capabilities.multiSpeaker}>
                    1リクエスト（&lt;|speaker:N|&gt;）
                  </option>
                </select>
                <button className="icon" title="シーンを生成" aria-label="シーンを生成" onClick={() => void generateScene(sc.id)}>
                  <Icon name="generate" size={14} />
                </button>
                <PlayButton session={session.scene(sc.id)} items={() => sceneItems(sc.id)} />
                <button
                  title="シーンを削除（行は残ります）"
                  onClick={() =>
                    useProject.getState().edit("シーンを削除", (d) => {
                      d.scenes = d.scenes.filter((y) => y.id !== sc.id);
                    })
                  }
                  className="icon"
                  aria-label="シーンを削除"
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
              {sc.mode === "single" && sc.takes.length > 0 && (
                <div className="muted small-text">
                  テイク {sc.takes.length}（最新 {sc.takes[sc.takes.length - 1].duration.toFixed(1)}s, 🎲{sc.takes[sc.takes.length - 1].seed ?? "?"}）
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
