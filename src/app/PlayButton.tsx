import { usePlayer, type PlayItem } from "../lib/player";
import { Icon } from "./icons";

/** ▶ starts its session, ⏸ pauses it, ▶ (highlighted) resumes from the same point. Another session stops it. */
export function PlayButton({ session, items, disabled, title, label, className }: { session: string; items: () => PlayItem[]; disabled?: boolean; title?: string; label?: string; className?: string }) {
  const state = usePlayer((s) => (s.sessionKey !== session ? "idle" : s.paused ? "paused" : "playing"));
  const tip = state === "playing" ? "一時停止" : state === "paused" ? "再開" : (title ?? "再生");
  return (
    <button
      className={`${className ?? ""}${state !== "idle" ? " on" : ""}`}
      disabled={disabled && state === "idle"}
      title={tip}
      aria-label={tip}
      onClick={(e) => {
        e.stopPropagation();
        usePlayer.getState().toggle(session, items);
      }}
    >
      <Icon name={state === "playing" ? "pause" : "play"} size={label ? 16 : 14} />
      {label}
    </button>
  );
}
