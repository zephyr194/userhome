import { describe, expect, it } from "vitest";
import { APP_ROUTES, routeSupportsBoard } from "./routeDefinitions";
import {
  boardViewFor,
  initialBoardViewState,
  reduceBoardView,
  type BoardViewState,
} from "./boardView";

const BOARD_ROUTES = ["services", "caddy", "appConfig", "aiConfig", "environment"];

describe("board route declaration", () => {
  it("只让服务、Caddy、应用配置、AI 配置与环境变量声明看板", () => {
    const declared = APP_ROUTES.filter((route) => routeSupportsBoard(route.id)).map(
      (route) => route.id,
    );
    expect(declared.sort()).toEqual([...BOARD_ROUTES].sort());
  });

  it("概览、设置与工具集不提供看板", () => {
    for (const id of ["dashboard", "settings", "tools"] as const) {
      expect(routeSupportsBoard(id), id).toBe(false);
    }
  });
});

describe("board view state", () => {
  const services: BoardViewState = initialBoardViewState("services");

  it("默认是紧凑视图", () => {
    expect(services).toEqual({ routeId: "services", view: "compact" });
  });

  it("支持看板的路由可以进入、退出与切换", () => {
    const entered = reduceBoardView(services, { type: "enter" });
    expect(entered.view).toBe("board");
    expect(reduceBoardView(entered, { type: "exit" }).view).toBe("compact");
    expect(reduceBoardView(services, { type: "toggle" }).view).toBe("board");
    expect(reduceBoardView(entered, { type: "toggle" }).view).toBe("compact");
  });

  it("不支持看板的路由拒绝进入，状态保持不变", () => {
    const tools = initialBoardViewState("tools");
    expect(reduceBoardView(tools, { type: "enter" })).toBe(tools);
    expect(reduceBoardView(tools, { type: "toggle" })).toBe(tools);
  });

  it("退出已是紧凑的状态时返回同一对象", () => {
    expect(reduceBoardView(services, { type: "exit" })).toBe(services);
  });

  it("切换路由时重置为紧凑，即使回到同一路由也重置", () => {
    const board = reduceBoardView(services, { type: "enter" });
    const moved = reduceBoardView(board, { type: "route", routeId: "dashboard" });
    expect(moved).toEqual({ routeId: "dashboard", view: "compact" });
    const back = reduceBoardView(moved, { type: "route", routeId: "services" });
    expect(back).toEqual({ routeId: "services", view: "compact" });
  });

  it("同一路由内的视图切换不会触发路由重置", () => {
    const board = reduceBoardView(services, { type: "enter" });
    expect(board.routeId).toBe("services");
    expect(board.view).toBe("board");
  });

  it("有效视图只属于当前路由；状态滞后于路由时回落为紧凑", () => {
    const board = reduceBoardView(services, { type: "enter" });
    expect(boardViewFor(board, "services")).toBe("board");
    expect(boardViewFor(board, "caddy")).toBe("compact");
  });
});
