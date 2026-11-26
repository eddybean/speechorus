// A button that opens a small popover; closes on Escape, on a click outside, or when an item is chosen.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";

export function Menu({
  label,
  ariaLabel,
  className,
  align = "start",
  placement = "below",
  children,
}: {
  label: ReactNode;
  ariaLabel?: string;
  className?: string;
  align?: "start" | "end";
  placement?: "below" | "right";
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button
        className={className}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {label}
      </button>
      {open && (
        <div className={`popover ${placement} ${align}`} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  icon,
  kbd,
  disabled,
  onSelect,
  children,
}: {
  icon?: IconName;
  kbd?: string;
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button className="menu-item" role="menuitem" disabled={disabled} onClick={onSelect}>
      {icon ? <Icon name={icon} /> : <span className="icon-gap" />}
      <span className="menu-label">{children}</span>
      {kbd && <kbd>{kbd}</kbd>}
    </button>
  );
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return <div className="menu-heading">{children}</div>;
}
