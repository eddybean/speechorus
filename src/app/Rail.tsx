// The left rail: the screens of the main pane (台本, ボイス, モデル; D-54) and the cast panel toggle, with the engine
// and settings at the bottom.
import { chosenProfile, useApp } from "../store/app";
import type { EngineState, ModelProfile } from "../lib/types";
import type { View } from "../store/app";
import { Menu, MenuHeading, MenuItem } from "./Menu";
import { Icon } from "./icons";

const stateLabel: Record<EngineState["state"], string> = {
  ready: "準備完了",
  loading: "読み込み中",
  failed: "失敗",
  stopped: "停止中",
};

const screens: { view: View; icon: string; label: string }[] = [
  { view: "script", icon: "script", label: "台本" },
  { view: "voices", icon: "voice", label: "ボイス" },
  { view: "models", icon: "chip", label: "モデル" },
];

export function Rail() {
  const castOpen = useApp((s) => s.castOpen);
  const view = useApp((s) => s.view);
  const engine = useApp((s) => s.engine);
  const app = useApp.getState;
  const castShown = castOpen && view === "script";
  return (
    <nav className="rail" aria-label="画面とパネル">
      <span className="logo" aria-hidden="true">
        S
      </span>
      <div className="rail-group">
        {screens.map((s) => (
          <button
            key={s.view}
            className="rail-item screen"
            aria-current={view === s.view ? "page" : undefined}
            onClick={() => app().setView(s.view)}
          >
            <Icon name={s.icon} size={18} />
            {s.label}
          </button>
        ))}
        <hr className="rail-sep" />
        <button
          className={`rail-item${castShown ? " on" : ""}`}
          aria-pressed={castShown}
          title={view === "script" ? "キャストパネルの表示/非表示" : "台本に戻ってキャストパネルを表示"}
          onClick={() => app().toggleCast()}
        >
          <Icon name="users" size={18} />
          キャスト
        </button>
      </div>
      <div className="rail-group">
        <Menu
          className="rail-item"
          placement="right"
          align="end"
          ariaLabel={`エンジン: ${stateLabel[engine.state]}`}
          label={
            <>
              <span className={`dot ${engine.state}`} />
              エンジン
            </>
          }
        >
          {(close) => <EnginePanel close={close} />}
        </Menu>
        <button className="rail-item" onClick={() => app().openDialog("settings")}>
          <Icon name="gear" size={18} />
          設定
        </button>
      </div>
    </nav>
  );
}

/**
 * The main action for the chosen profile: start it, switch to it, get a model first (it has none, so starting
 * would only fail), or nothing (it is already loaded or loading).
 */
export function engineAction(
  engine: EngineState,
  profile: ModelProfile | undefined,
): "start" | "switch" | "getModel" | null {
  if (!profile || engine.state === "loading") return null;
  if (engine.state === "ready" && engine.profileId === profile.id) return null;
  if (!profile.model) return "getModel";
  return engine.state === "ready" ? "switch" : "start";
}

function EnginePanel({ close }: { close: () => void }) {
  const settings = useApp((s) => s.settings);
  const engine = useApp((s) => s.engine);
  const app = useApp.getState;
  const chosen = chosenProfile(settings);
  const action = engineAction(engine, chosen);
  const running = engine.state === "ready" || engine.state === "loading";
  return (
    <div className="engine-panel">
      <MenuHeading>
        エンジン <span className={`engine-state ${engine.state}`}>{stateLabel[engine.state]}</span>
      </MenuHeading>
      {engine.state === "failed" && <p className="warn-text">{engine.message}</p>}
      {settings?.profiles.map((p) => (
        <button
          key={p.id}
          className={`menu-item${p.id === chosen?.id ? " chosen" : ""}`}
          role="menuitemradio"
          aria-checked={p.id === chosen?.id}
          disabled={engine.state === "loading"}
          onClick={() => void app().saveSettings({ ...settings, activeProfileId: p.id })}
        >
          <span className={`dot ${"profileId" in engine && engine.profileId === p.id ? engine.state : "stopped"}`} />
          <span className="menu-label">{p.name}</span>
          {!p.model && <kbd>モデル未設定</kbd>}
        </button>
      ))}
      <div className="engine-actions">
        {action === "getModel" && (
          <button
            className="primary"
            onClick={() => {
              close();
              app().openDialog("catalog");
            }}
          >
            <Icon name="download" />
            モデルを入手…
          </button>
        )}
        {chosen && (action === "start" || action === "switch") && (
          <button className="primary" onClick={() => void app().startEngine(chosen.id)}>
            {chosen.name} {action === "start" ? "を起動" : "に切替"}
          </button>
        )}
        {running && (
          <button onClick={() => void app().stopEngine()}>
            <Icon name="stop" />
            エンジンを停止
          </button>
        )}
      </div>
      <hr />
      {action !== "getModel" && (
        <MenuItem
          icon="download"
          onSelect={() => {
            close();
            app().openDialog("catalog");
          }}
        >
          モデルを入手…
        </MenuItem>
      )}
      <MenuItem
        icon="chip"
        onSelect={() => {
          close();
          app().setView("models");
        }}
      >
        モデル管理…
      </MenuItem>
    </div>
  );
}
