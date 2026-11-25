import { usePlayer, type PlayItem } from "../lib/player";

/** ▶ while idle, ■ while its own session plays; another session stops it. */
export function PlayButton({ session, items, disabled, title, label, className }: { session: string; items: () => PlayItem[]; disabled?: boolean; title?: string; label?: string; className?: string }) {
  const playing = usePlayer((s) => s.sessionKey === session);
  return (
    <button
      className={`${className ?? ""}${playing ? " on" : ""}`}
      disabled={disabled && !playing}
      title={playing ? "停止" : (title ?? "再生")}
      aria-label={playing ? "停止" : (title ?? "再生")}
      onClick={(e) => {
        e.stopPropagation();
        usePlayer.getState().toggle(session, items);
      }}
    >
      {playing ? "■" : "▶"}
      {label ? ` ${label}` : ""}
    </button>
  );
}
