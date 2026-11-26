import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TopBar } from "./TopBar";
import { useProject } from "../store/project";

vi.mock("../features/generate/actions", async (orig) => ({
  ...(await orig<typeof import("../features/generate/actions")>()),
  generateSelected: vi.fn(),
  generateMissing: vi.fn(),
  generateAll: vi.fn(),
}));
vi.mock("../features/project/fileOps", () => ({
  newProject: vi.fn(),
  openProject: vi.fn(),
  saveProject: vi.fn(),
  importScript: vi.fn(),
}));

import { generateAll, generateMissing, generateSelected } from "../features/generate/actions";
import { saveProject } from "../features/project/fileOps";

describe("TopBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProject.setState({ dirty: false });
  });

  it("shows only the everyday controls; the rest sit in menus", () => {
    render(<TopBar />);
    expect(screen.getByRole("button", { name: "ファイル" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "選択行を生成" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "生成の種類と設定" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "選択行から連続再生" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "書き出し" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /元に戻す/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /全行を生成/ })).toBeNull();
  });

  it("generates the selected lines from the main button", () => {
    render(<TopBar />);
    fireEvent.click(screen.getByRole("button", { name: "選択行を生成" }));
    expect(generateSelected).toHaveBeenCalled();
  });

  it("offers the other generate targets and the take/seed settings in the ▾ menu", () => {
    render(<TopBar />);
    fireEvent.click(screen.getByRole("button", { name: "生成の種類と設定" }));
    expect(screen.getByLabelText("1行あたりのテイク")).toBeTruthy();
    expect(screen.getByLabelText("シード")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /テイクが無い行だけ生成/ }));
    expect(generateMissing).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "生成の種類と設定" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /全行を生成/ }));
    expect(generateAll).toHaveBeenCalled();
  });

  it("keeps file and edit commands in the ファイル menu", () => {
    render(<TopBar />);
    fireEvent.click(screen.getByRole("button", { name: "ファイル" }));
    for (const name of [/新規/, /開く/, /^保存/, /名前を付けて保存/, /取り込み/, /元に戻す/, /やり直し/]) {
      expect(screen.getByRole("menuitem", { name })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("menuitem", { name: /^保存/ }));
    expect(saveProject).toHaveBeenCalled();
    expect(screen.queryByRole("menuitem", { name: /新規/ })).toBeNull();
  });

  it("marks an unsaved project", () => {
    useProject.setState({ dirty: true });
    render(<TopBar />);
    expect(screen.getByText("未保存")).toBeTruthy();
  });
});
