import { act, fireEvent, render, screen } from "@testing-library/react";
import { ContextMenu, hasMenu, menuTarget } from "./ContextMenu";

function el(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.querySelector<HTMLElement>("#t")!;
}

describe("menuTarget", () => {
  it("finds text fields but not other inputs", () => {
    expect(menuTarget(el(`<input id="t" type="text">`)).field).toBeInstanceOf(HTMLInputElement);
    expect(menuTarget(el(`<textarea id="t"></textarea>`)).field).toBeInstanceOf(HTMLTextAreaElement);
    expect(menuTarget(el(`<input id="t" type="range">`)).field).toBeNull();
    expect(menuTarget(el(`<input id="t" type="checkbox">`)).field).toBeNull();
  });

  it("finds the script line under the pointer", () => {
    const t = menuTarget(el(`<div data-line-id="L1"><span id="t">1</span></div>`));
    expect(t.lineId).toBe("L1");
    expect(hasMenu(t)).toBe(true);
  });

  it("has no menu on plain UI unless text is selected there", () => {
    expect(hasMenu(menuTarget(el(`<button id="t">x</button>`)))).toBe(false);
    expect(hasMenu(menuTarget(el(`<pre id="t">log</pre>`), "log"))).toBe(true);
  });
});

describe("ContextMenu", () => {
  it("replaces the WebView menu, opening its own only where it has items", () => {
    render(
      <>
        <ContextMenu />
        <button>plain</button>
        <input aria-label="field" />
      </>,
    );
    const plain = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    act(() => void screen.getByText("plain").dispatchEvent(plain));
    expect(plain.defaultPrevented).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();

    act(() => void fireEvent.contextMenu(screen.getByLabelText("field")));
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByText("貼り付け")).toBeTruthy();
    expect(screen.getByText("元に戻す")).toBeTruthy();
    expect(screen.queryByText("この行を生成")).toBeNull();

    act(() => void fireEvent.keyDown(window, { key: "Escape" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
