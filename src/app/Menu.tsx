// A button that opens a small popover; closes on Escape, on a click outside, or when an item is chosen.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
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

/** How long the pointer may be off a submenu (crossing the gap, a diagonal move) before it closes. */
const SUBMENU_CLOSE_MS = 250;

/**
 * A menu item that opens a nested menu to its right: on hover, on click, or with →/Enter; ← closes it again.
 * Inside it, a digit key chooses the item marked with that `data-accel`. Disabled when it has nothing to show.
 */
export function SubMenu({
  icon,
  label,
  disabled,
  children,
}: {
  icon?: IconName;
  label: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const cancelClose = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancelClose, []);
  const show = (focusFirst = false) => {
    cancelClose();
    setOpen(true);
    if (focusFirst) requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus());
  };
  const hide = (refocus = false) => {
    cancelClose();
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const onTriggerKey = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      show(true);
    }
  };
  const onPanelKey = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      e.stopPropagation();
      hide(true);
    } else if (/^[1-9]$/.test(e.key)) {
      const item = panel.current?.querySelector<HTMLElement>(`[data-accel="${e.key}"]`);
      if (item) {
        e.preventDefault();
        item.click();
      }
    }
  };
  return (
    <div
      className="submenu"
      onMouseEnter={() => !disabled && show()}
      onMouseLeave={() => {
        cancelClose();
        timer.current = setTimeout(() => setOpen(false), SUBMENU_CLOSE_MS);
      }}
    >
      <button
        ref={trigger}
        className={`menu-item${open ? " chosen" : ""}`}
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? hide() : show())}
        onKeyDown={onTriggerKey}
      >
        {icon ? <Icon name={icon} /> : <span className="icon-gap" />}
        <span className="menu-label">{label}</span>
        <Icon name="chevronRight" size={14} />
      </button>
      {open && (
        <div ref={panel} className="popover right start" role="menu" onKeyDown={onPanelKey}>
          {children}
        </div>
      )}
    </div>
  );
}
