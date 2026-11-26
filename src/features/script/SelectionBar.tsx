// Shown above the script while two or more lines are selected: what can be done to all of them.
import { useProject } from "../../store/project";
import { createScene, generateIds } from "../generate/actions";
import { copyLines } from "./clipboard";
import { Icon } from "../../app/icons";

export function SelectionBar() {
  const selection = useProject((s) => s.selection);
  if (selection.length < 2) return null;
  const p = useProject.getState;
  return (
    <div className="selection-bar" role="toolbar" aria-label="選択した行の操作">
      <span className="count">{selection.length} 行を選択中</span>
      <span className="spacer" />
      <button onClick={() => void generateIds(selection)}>
        <Icon name="generate" />
        生成
      </button>
      <button onClick={() => createScene(selection)}>
        <Icon name="scene" />
        シーンにまとめる
      </button>
      <button onClick={() => void copyLines()}>
        <Icon name="copy" />
        コピー
      </button>
      <button onClick={() => p().duplicateLines(selection)}>
        <Icon name="duplicate" />
        複製
      </button>
      <button onClick={() => p().removeLines(selection)}>
        <Icon name="trash" />
        削除
      </button>
      <button className="icon" aria-label="選択を解除" title="選択を解除 (Esc)" onClick={() => p().select([], null)}>
        <Icon name="close" />
      </button>
    </div>
  );
}
