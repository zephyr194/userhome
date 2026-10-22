import { createContext, useContext } from "react";
import type { BoardView } from "./boardView";

export interface BoardViewContextValue {
  available: boolean;
  view: BoardView;
  isBoard: boolean;
  enter: () => void;
  exit: () => void;
  toggle: () => void;
}

const noop = () => undefined;

const UNAVAILABLE: BoardViewContextValue = {
  available: false,
  view: "compact",
  isBoard: false,
  enter: noop,
  exit: noop,
  toggle: noop,
};

export const BoardViewContext =
  createContext<BoardViewContextValue>(UNAVAILABLE);

export function useBoardView(): BoardViewContextValue {
  return useContext(BoardViewContext);
}
