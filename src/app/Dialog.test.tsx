import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { flushSync } from "react-dom";
import { create } from "zustand";
import { Dialog } from "./Dialog";

// Stands for the line selection, which the app's own Esc handler clears before the dialog sees the key.
const useTick = create<{ n: number }>(() => ({ n: 0 }));

function Host({ onClose }: { onClose: () => void }) {
  const n = useTick((s) => s.n);
  // A new onClose on every render, as the dialogs pass an inline arrow.
  return (
    <Dialog title="書き出し" onClose={() => onClose()}>
      <p>{n}</p>
    </Dialog>
  );
}

describe("Dialog", () => {
  let earlier: ((e: KeyboardEvent) => void) | null = null;
  afterEach(() => {
    if (earlier) window.removeEventListener("keydown", earlier);
    earlier = null;
  });

  it("closes on Esc", () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Esc when an earlier keydown listener re-renders it", () => {
    // In the WebView the earlier listener's store update renders between listeners (a microtask);
    // flushSync does the same here.
    earlier = (e) => e.key === "Escape" && flushSync(() => useTick.setState((s) => ({ n: s.n + 1 })));
    window.addEventListener("keydown", earlier);
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByText("1")).toBeTruthy();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
