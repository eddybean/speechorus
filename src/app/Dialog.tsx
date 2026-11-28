import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { Icon } from "./icons";

export function Dialog({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  // One listener for the dialog's life, calling the latest onClose. Re-adding it whenever onClose changed (each
  // render) lost Esc: the app's own Esc handler clears the line selection first, the dialog re-renders during
  // that keydown, and a listener added mid-dispatch is not called for it.
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog${wide ? " wide" : ""}`} role="dialog" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="icon" onClick={onClose} aria-label="閉じる">
            <Icon name="close" />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}
