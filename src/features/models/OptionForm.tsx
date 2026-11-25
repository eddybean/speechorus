// A settings form generated from an adapter's option schema. Unset options use the model's default.
import type { Json, OptionSpec, Options } from "../../lib/types";

export function OptionForm({ specs, values, onChange, inherited }: { specs: OptionSpec[]; values: Options; onChange: (name: string, v: Json | null) => void; inherited?: Options }) {
  return (
    <div className="options">
      {specs.map((s) => {
        const set = values[s.name] !== undefined && values[s.name] !== null;
        const base = inherited?.[s.name] ?? s.default;
        const v = set ? values[s.name] : base;
        return (
          <label key={s.name} className={`opt${set ? " set" : ""}`} title={s.help}>
            <span className="opt-name">
              <input type="checkbox" checked={set} onChange={(e) => onChange(s.name, e.target.checked ? (base ?? (s.kind === "bool" ? false : s.min ?? 0)) : null)} />
              {s.label}
            </span>
            {s.kind === "bool" ? (
              <input type="checkbox" disabled={!set} checked={!!v} onChange={(e) => onChange(s.name, e.target.checked)} />
            ) : s.kind === "string" ? (
              <input type="text" disabled={!set} value={String(v ?? "")} onChange={(e) => onChange(s.name, e.target.value)} />
            ) : (
              <span className="opt-num">
                <input
                  type="range"
                  disabled={!set}
                  min={s.min ?? 0}
                  max={s.max !== null && s.max < 1000 ? s.max : Math.max(Number(v ?? 0) * 4, 100)}
                  step={s.step ?? (s.kind === "int" ? 1 : 0.01)}
                  value={Number(v ?? s.min ?? 0)}
                  onChange={(e) => onChange(s.name, s.kind === "int" ? Math.round(Number(e.target.value)) : Number(e.target.value))}
                />
                <input
                  type="number"
                  disabled={!set}
                  min={s.min ?? undefined}
                  max={s.max ?? undefined}
                  step={s.step ?? (s.kind === "int" ? 1 : 0.01)}
                  value={v === null || v === undefined ? "" : Number(v)}
                  onChange={(e) => e.target.value !== "" && onChange(s.name, s.kind === "int" ? Math.round(Number(e.target.value)) : Number(e.target.value))}
                />
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}
