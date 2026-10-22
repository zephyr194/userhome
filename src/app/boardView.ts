import { routeSupportsBoard, type AppRouteId } from "./routeDefinitions";

export type BoardView = "compact" | "board";

export interface BoardViewState {
  routeId: AppRouteId;
  view: BoardView;
}

export type BoardViewAction =
  | { type: "route"; routeId: AppRouteId }
  | { type: "enter" }
  | { type: "exit" }
  | { type: "toggle" };

export function initialBoardViewState(routeId: AppRouteId): BoardViewState {
  return { routeId, view: "compact" };
}

export function reduceBoardView(
  state: BoardViewState,
  action: BoardViewAction,
): BoardViewState {
  switch (action.type) {
    case "route":
      return { routeId: action.routeId, view: "compact" };
    case "enter":
      return routeSupportsBoard(state.routeId) && state.view !== "board"
        ? { ...state, view: "board" }
        : state;
    case "exit":
      return state.view === "compact" ? state : { ...state, view: "compact" };
    case "toggle":
      return reduceBoardView(state, {
        type: state.view === "board" ? "exit" : "enter",
      });
  }
}

/** The view for `routeId`; a state that still belongs to another route reads as compact. */
export function boardViewFor(state: BoardViewState, routeId: AppRouteId): BoardView {
  return state.routeId === routeId && routeSupportsBoard(routeId) ? state.view : "compact";
}
