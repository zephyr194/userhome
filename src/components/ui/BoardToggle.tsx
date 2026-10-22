import { useBoardView } from "../../app/BoardViewContext";
import { Button } from "./Button";

export function BoardToggle() {
  const { available, isBoard, toggle } = useBoardView();
  if (!available) return null;
  return (
    <Button aria-pressed={isBoard} onClick={toggle}>
      <span aria-hidden="true">▣</span>
      {isBoard ? "退出看板" : "看板"}
    </Button>
  );
}
