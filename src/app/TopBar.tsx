// The top bar: only what is used all the time — file menu, project name, generate, play, export.
import { useApp } from "../store/app";
import { useProject } from "../store/project";
import { usePlayer } from "../lib/player";
import { generateAll, generateMissing, generateSelected, fromItems, session } from "../features/generate/actions";
import { importScript, newProject, openProject, saveProject } from "../features/project/fileOps";
import type { SeedMode } from "../lib/text";
import { PlayButton } from "./PlayButton";
import { Menu, MenuHeading, MenuItem } from "./Menu";
import { Icon, modKey } from "./icons";

export function TopBar() {
  const dirty = useProject((s) => s.dirty);
  const name = useProject((s) => s.project.name);
  const activeLineId = useProject((s) => s.activeLineId);
  const active = usePlayer((s) => s.sessionKey !== null);
  return (
    <header className="topbar">
      <div className="zone">
        <FileMenu />
        <span className="title" title={name}>
          {name}
          {dirty && <small className="dirty">未保存</small>}
        </span>
      </div>
      <div className="zone center">
        <GenerateButton />
        <PlayButton
          session={session.sequence}
          items={() => fromItems(activeLineId)}
          title="選択行から連続再生"
          label="連続再生"
        />
        {active && (
          <button onClick={() => usePlayer.getState().stop()} title="停止（位置を破棄して頭に戻す）">
            <Icon name="stop" />
            停止
          </button>
        )}
        <VolumeControl />
      </div>
      <div className="zone end">
        <button onClick={() => useApp.getState().openDialog("export")}>
          <Icon name="export" />
          書き出し
        </button>
      </div>
    </header>
  );
}

/** The volume of every playback in the app (not of exported files). Wheel over it for 5% steps. */
export function VolumeControl() {
  const volume = useApp((s) => s.settings?.playbackVolume ?? 1);
  const muted = useApp((s) => s.settings?.playbackMuted ?? false);
  const disabled = useApp((s) => !s.settings);
  const setPlayback = useApp.getState().setPlayback;
  const pct = Math.round(volume * 100);
  const silent = muted || pct === 0;
  const step = (delta: number) => setPlayback({ volume: Math.round(pct + delta) / 100, muted: false });
  return (
    <div
      className={`volume${muted ? " muted" : ""}`}
      title={muted ? `再生音量 ${pct}%（ミュート中）` : `再生音量 ${pct}%`}
      onWheel={(e) => !disabled && e.deltaY !== 0 && step(e.deltaY < 0 ? 5 : -5)}
    >
      <button
        className="icon ghost"
        disabled={disabled}
        aria-label={silent ? "ミュート解除" : "ミュート"}
        aria-pressed={muted}
        onClick={() =>
          setPlayback(muted || pct === 0 ? { muted: false, ...(pct === 0 && { volume: 0.5 }) } : { muted: true })
        }
      >
        <Icon name={silent ? "volumeMute" : pct < 50 ? "volumeLow" : "volume"} />
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={pct}
        disabled={disabled}
        aria-label="再生音量"
        aria-valuetext={muted ? `${pct}%（ミュート中）` : `${pct}%`}
        onChange={(e) => setPlayback({ volume: Number(e.target.value) / 100, muted: false })}
      />
    </div>
  );
}

function FileMenu() {
  const canUndo = useProject((s) => s.undoStack.length > 0);
  const canRedo = useProject((s) => s.redoStack.length > 0);
  return (
    <Menu
      className="ghost"
      label={
        <>
          <Icon name="file" />
          ファイル
          <Icon name="chevron" size={14} />
        </>
      }
      ariaLabel="ファイル"
    >
      {(close) => {
        const run = (f: () => unknown) => () => {
          close();
          void f();
        };
        return (
          <>
            <MenuItem icon="file" onSelect={run(newProject)}>
              新規
            </MenuItem>
            <MenuItem icon="open" kbd={`${modKey}O`} onSelect={run(() => openProject())}>
              開く…
            </MenuItem>
            <MenuItem icon="save" kbd={`${modKey}S`} onSelect={run(() => saveProject())}>
              保存
            </MenuItem>
            <MenuItem onSelect={run(() => saveProject(true))}>名前を付けて保存…</MenuItem>
            <MenuItem icon="import" onSelect={run(importScript)}>
              台本（txt/csv）を取り込み…
            </MenuItem>
            <hr />
            <MenuHeading>編集</MenuHeading>
            <MenuItem
              icon="undo"
              kbd={`${modKey}Z`}
              disabled={!canUndo}
              onSelect={run(() => useProject.getState().undo())}
            >
              元に戻す
            </MenuItem>
            <MenuItem
              icon="redo"
              kbd={modKey === "⌘" ? "⇧⌘Z" : "Ctrl+Y"}
              disabled={!canRedo}
              onSelect={run(() => useProject.getState().redo())}
            >
              やり直し
            </MenuItem>
          </>
        );
      }}
    </Menu>
  );
}

function GenerateButton() {
  const batch = useApp((s) => s.batch);
  const set = useApp((s) => s.setBatch);
  return (
    <div className="split">
      <button
        className="primary"
        onClick={() => void generateSelected()}
        title={`選択行を生成 (${modKey}Enter)`}
        aria-label="選択行を生成"
      >
        <Icon name="generate" />
        選択行を生成
      </button>
      <Menu className="primary split-toggle" label={<Icon name="chevron" size={14} />} ariaLabel="生成の種類と設定">
        {(close) => (
          <>
            <MenuItem
              icon="generate"
              kbd={`${modKey}↩`}
              onSelect={() => {
                close();
                void generateSelected();
              }}
            >
              選択行を生成
            </MenuItem>
            <MenuItem
              icon="generate"
              onSelect={() => {
                close();
                void generateMissing();
              }}
            >
              テイクが無い行だけ生成
            </MenuItem>
            <MenuItem
              icon="generate"
              onSelect={() => {
                close();
                void generateAll();
              }}
            >
              全行を生成
            </MenuItem>
            <hr />
            <div className="menu-form">
              <label>
                1行あたりのテイク
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={batch.takesPerLine}
                  onChange={(e) => set({ takesPerLine: Math.max(1, Number(e.target.value)) })}
                />
              </label>
              <label>
                シード
                <select value={batch.seedMode} onChange={(e) => set({ seedMode: seedMode(e.target.value) })}>
                  <option value="random">ランダム</option>
                  <option value="fixed">固定</option>
                  <option value="sequential">連番</option>
                </select>
              </label>
              {batch.seedMode !== "random" && (
                <label>
                  シード値
                  <input
                    type="number"
                    min={0}
                    value={batch.baseSeed}
                    onChange={(e) => set({ baseSeed: Number(e.target.value) })}
                  />
                </label>
              )}
            </div>
          </>
        )}
      </Menu>
    </div>
  );
}

function seedMode(v: string): SeedMode {
  return v === "fixed" || v === "sequential" ? v : "random";
}
