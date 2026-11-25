// The cast: each speaker's voice (library voice or none + design prompt) and default options.
import { useState } from "react";
import { useApp } from "../../store/app";
import { newCast, useProject } from "../../store/project";
import { OptionForm } from "../models/OptionForm";
import type { Cast } from "../../lib/types";

export function CastPanel() {
  const cast = useProject((s) => s.project.cast);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <aside className="cast">
      <h3>
        キャスト
        <button
          className="small"
          onClick={() =>
            useProject.getState().edit("キャストを追加", (d) => {
              d.cast.push(newCast(`キャスト${d.cast.length + 1}`, d.cast.length));
            })
          }
        >
          ＋
        </button>
      </h3>
      {cast.map((c) => (
        <CastCard key={c.id} cast={c} open={open === c.id} toggle={() => setOpen(open === c.id ? null : c.id)} />
      ))}
      <button className="wide" onClick={() => useApp.getState().openDialog("voices")}>
        🎙 ボイスライブラリ
      </button>
    </aside>
  );
}

function CastCard({ cast, open, toggle }: { cast: Cast; open: boolean; toggle: () => void }) {
  const voices = useApp((s) => s.voices);
  const adapter = useApp((s) => s.activeAdapter());
  const lineCount = useProject((s) => s.project.lines.filter((l) => l.castId === cast.id).length);
  const edit = (label: string, f: (c: Cast) => void, key?: string) =>
    useProject.getState().edit(
      label,
      (d) => {
        const c = d.cast.find((x) => x.id === cast.id);
        if (c) f(c);
      },
      key,
    );
  const family = adapter?.id;
  const usable = voices.filter((v) => v.family === family);
  const voice = voices.find((v) => v.id === cast.voiceId);
  const mismatch = voice && voice.family !== family;
  return (
    <div className="cast-card" style={{ borderLeftColor: cast.color }}>
      <div className="cast-head">
        <input type="color" value={cast.color} onChange={(e) => edit("色", (c) => (c.color = e.target.value), `color:${cast.id}`)} />
        <input className="cast-name" value={cast.name} onChange={(e) => edit("キャスト名", (c) => (c.name = e.target.value), `name:${cast.id}`)} />
        <span className="muted" title="行数">
          {lineCount}
        </span>
        <button className="small" onClick={toggle}>
          {open ? "▴" : "▾"}
        </button>
      </div>
      <select value={cast.voiceId ?? ""} onChange={(e) => edit("ボイス", (c) => (c.voiceId = e.target.value || null))}>
        <option value="">ボイスなし（モデルにおまかせ）</option>
        {usable.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
            {v.speakers > 1 ? `（${v.speakers}話者）` : ""}
            {!v.file && v.prompt ? "（説明のみ）" : ""}
          </option>
        ))}
        {voice && mismatch && <option value={voice.id}>{voice.name}（{voice.family} 用・現在のモデルでは無効）</option>}
      </select>
      {mismatch && <div className="warn-text">このボイスは {voice.family} 用です。現在のモデルでは「ボイスなし」として生成します。</div>}
      {open && (
        <>
          <label className="block">
            {adapter?.capabilities.designPrompt === "instructions" ? "声と話し方の説明 (instructions)" : "ボイスデザイン（先頭に [..] として挿入）"}
            <textarea
              rows={3}
              placeholder="例: 落ち着いた25歳の女性。親密な相手に耳元で優しく囁く。"
              value={cast.designPrompt}
              onChange={(e) => edit("ボイスデザイン", (c) => (c.designPrompt = e.target.value), `design:${cast.id}`)}
            />
          </label>
          {adapter && (
            <details>
              <summary>既定のオプション</summary>
              <OptionForm
                specs={adapter.options}
                values={cast.defaultOptions}
                onChange={(name, v) =>
                  edit("キャストのオプション", (c) => {
                    if (v === null) delete c.defaultOptions[name];
                    else c.defaultOptions[name] = v;
                  })
                }
              />
            </details>
          )}
          <button
            className="danger small"
            disabled={useProject.getState().project.cast.length <= 1}
            onClick={() =>
              useProject.getState().edit("キャストを削除", (d) => {
                d.cast = d.cast.filter((c) => c.id !== cast.id);
                for (const l of d.lines) if (l.castId === cast.id) l.castId = null;
              })
            }
          >
            キャストを削除
          </button>
        </>
      )}
    </div>
  );
}
