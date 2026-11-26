import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SelectionBar } from "./SelectionBar";
import { useProject } from "../../store/project";

vi.mock("../generate/actions", () => ({ generateIds: vi.fn(), createScene: vi.fn() }));
vi.mock("./clipboard", () => ({ copyLines: vi.fn() }));

import { createScene, generateIds } from "../generate/actions";
import { copyLines } from "./clipboard";

const duplicateLines = vi.fn();
const removeLines = vi.fn();

function select(ids: string[]) {
  useProject.setState({ selection: ids, activeLineId: ids[0] ?? null, duplicateLines, removeLines });
}

describe("SelectionBar", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stays hidden for a single line", () => {
    select(["a"]);
    const { container } = render(<SelectionBar />);
    expect(container.textContent).toBe("");
  });

  it("acts on all selected lines", () => {
    select(["a", "b", "c"]);
    render(<SelectionBar />);
    expect(screen.getByText("3 行を選択中")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /生成/ }));
    expect(generateIds).toHaveBeenCalledWith(["a", "b", "c"]);
    fireEvent.click(screen.getByRole("button", { name: /シーンにまとめる/ }));
    expect(createScene).toHaveBeenCalledWith(["a", "b", "c"]);
    fireEvent.click(screen.getByRole("button", { name: /コピー/ }));
    expect(copyLines).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /複製/ }));
    expect(duplicateLines).toHaveBeenCalledWith(["a", "b", "c"]);
    fireEvent.click(screen.getByRole("button", { name: /削除/ }));
    expect(removeLines).toHaveBeenCalledWith(["a", "b", "c"]);
  });

  it("clears the selection", () => {
    select(["a", "b"]);
    render(<SelectionBar />);
    fireEvent.click(screen.getByRole("button", { name: "選択を解除" }));
    expect(useProject.getState().selection).toEqual([]);
  });
});
