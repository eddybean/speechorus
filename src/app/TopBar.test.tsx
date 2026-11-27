import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TopBar, splitPath } from "./TopBar";
import { useProject } from "../store/project";
import { useApp } from "../store/app";
import type { AppSettings } from "../lib/types";

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
  openRecentProject: vi.fn(),
  forgetRecentProjects: vi.fn(),
}));

import { generateAll, generateMissing, generateSelected } from "../features/generate/actions";
import { forgetRecentProjects, openRecentProject, saveProject } from "../features/project/fileOps";

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

  describe("volume", () => {
    const settings = {
      theme: "dark",
      profiles: [],
      recentTags: [],
      recentProjects: [],
      playbackVolume: 0.8,
      playbackMuted: false,
    } as unknown as AppSettings;
    const st = () => useApp.getState().settings!;

    beforeEach(() => useApp.setState({ settings }));

    it("sets the volume from the slider and unmutes", () => {
      useApp.setState({ settings: { ...settings, playbackMuted: true } });
      render(<TopBar />);
      const slider = screen.getByRole("slider", { name: "再生音量" }) as HTMLInputElement;
      expect(slider.value).toBe("80");
      fireEvent.change(slider, { target: { value: "35" } });
      expect(st().playbackVolume).toBe(0.35);
      expect(st().playbackMuted).toBe(false);
    });

    it("mutes and unmutes from the speaker button, keeping the level", () => {
      render(<TopBar />);
      fireEvent.click(screen.getByRole("button", { name: "ミュート" }));
      expect(st().playbackMuted).toBe(true);
      expect(st().playbackVolume).toBe(0.8);
      fireEvent.click(screen.getByRole("button", { name: "ミュート解除" }));
      expect(st().playbackMuted).toBe(false);
    });

    it("brings a volume of 0 back to half when unmuting", () => {
      useApp.setState({ settings: { ...settings, playbackVolume: 0 } });
      render(<TopBar />);
      fireEvent.click(screen.getByRole("button", { name: "ミュート解除" }));
      expect(st().playbackVolume).toBe(0.5);
    });

    it("steps by 5% with the wheel, within 0 to 200%", () => {
      useApp.setState({ settings: { ...settings, playbackVolume: 1.98 } });
      render(<TopBar />);
      const slider = screen.getByRole("slider", { name: "再生音量" });
      fireEvent.wheel(slider, { deltaY: -100 });
      expect(st().playbackVolume).toBe(2);
      fireEvent.wheel(slider, { deltaY: 100 });
      fireEvent.wheel(slider, { deltaY: 100 });
      expect(st().playbackVolume).toBe(1.9);
    });

    it("goes up to 200% and back to 100% on double-click", () => {
      render(<TopBar />);
      const slider = screen.getByRole("slider", { name: "再生音量" }) as HTMLInputElement;
      expect(slider.max).toBe("200");
      fireEvent.change(slider, { target: { value: "170" } });
      expect(st().playbackVolume).toBe(1.7);
      fireEvent.doubleClick(slider);
      expect(st().playbackVolume).toBe(1);
    });

    it("is disabled until the settings are loaded", () => {
      useApp.setState({ settings: null });
      render(<TopBar />);
      expect((screen.getByRole("slider", { name: "再生音量" }) as HTMLInputElement).disabled).toBe(true);
    });
  });

  describe("最近使ったファイル", () => {
    const recentProjects = ["C:\\work\\drama\\第1話.vsproj", "D:/voices/sample.vsproj"];
    const settings = { theme: "dark", profiles: [], recentTags: [], recentProjects } as unknown as AppSettings;
    const openSub = () => {
      fireEvent.click(screen.getByRole("button", { name: "ファイル" }));
      fireEvent.click(screen.getByRole("menuitem", { name: /最近使ったファイル/ }));
    };

    beforeEach(() => {
      useApp.setState({ settings });
      useProject.setState({ path: null });
    });

    it("is disabled while the list is empty", () => {
      useApp.setState({ settings: { ...settings, recentProjects: [] } });
      render(<TopBar />);
      fireEvent.click(screen.getByRole("button", { name: "ファイル" }));
      const item = screen.getByRole("menuitem", { name: /最近使ったファイル/ }) as HTMLButtonElement;
      expect(item.disabled).toBe(true);
      fireEvent.mouseEnter(item.parentElement!);
      expect(screen.queryByRole("menuitem", { name: /第1話/ })).toBeNull();
    });

    it("opens on hover and lists the files newest first, with the folder", () => {
      render(<TopBar />);
      fireEvent.click(screen.getByRole("button", { name: "ファイル" }));
      expect(screen.queryByRole("menuitem", { name: /第1話/ })).toBeNull();
      fireEvent.mouseEnter(screen.getByRole("menuitem", { name: /最近使ったファイル/ }).parentElement!);
      const items = screen.getAllByRole("menuitem").filter((e) => e.classList.contains("recent-file"));
      expect(items.map((e) => e.textContent)).toEqual(["1第1話C:\\work\\drama", "2sampleD:/voices"]);
      expect(items[0].title).toBe(recentProjects[0]);
    });

    it("opens the chosen file and closes the menu", () => {
      render(<TopBar />);
      openSub();
      fireEvent.click(screen.getByRole("menuitem", { name: /sample/ }));
      expect(openRecentProject).toHaveBeenCalledWith("D:/voices/sample.vsproj");
      expect(screen.queryByRole("menuitem", { name: /新規/ })).toBeNull();
    });

    it("marks the open project", () => {
      useProject.setState({ path: recentProjects[1] });
      render(<TopBar />);
      openSub();
      expect(screen.getByRole("menuitem", { name: /sample/ }).classList.contains("chosen")).toBe(true);
      expect(screen.getByRole("menuitem", { name: /第1話/ }).classList.contains("chosen")).toBe(false);
    });

    it("clears the list", () => {
      render(<TopBar />);
      openSub();
      fireEvent.click(screen.getByRole("menuitem", { name: "一覧をクリア" }));
      expect(forgetRecentProjects).toHaveBeenCalledWith();
    });

    it("works from the keyboard: → opens, a digit chooses, ← goes back", () => {
      render(<TopBar />);
      fireEvent.click(screen.getByRole("button", { name: "ファイル" }));
      const trigger = screen.getByRole("menuitem", { name: /最近使ったファイル/ });
      fireEvent.keyDown(trigger, { key: "ArrowRight" });
      const first = screen.getByRole("menuitem", { name: /第1話/ });
      fireEvent.keyDown(first, { key: "ArrowLeft" });
      expect(screen.queryByRole("menuitem", { name: /第1話/ })).toBeNull();
      fireEvent.keyDown(trigger, { key: "ArrowRight" });
      fireEvent.keyDown(screen.getByRole("menuitem", { name: /第1話/ }), { key: "2" });
      expect(openRecentProject).toHaveBeenCalledWith("D:/voices/sample.vsproj");
    });
  });
});

describe("splitPath", () => {
  it("splits Windows and POSIX paths and drops the extension", () => {
    expect(splitPath("C:\\a\\b\\x.vsproj")).toEqual({ name: "x", dir: "C:\\a\\b" });
    expect(splitPath("/a/y.VSPROJ")).toEqual({ name: "y", dir: "/a" });
    expect(splitPath("z.vsproj")).toEqual({ name: "z", dir: "" });
  });
});
