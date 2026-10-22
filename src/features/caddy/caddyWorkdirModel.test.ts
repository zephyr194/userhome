import { describe, expect, it } from "vitest";
import type { CaddyWorkdirStatus } from "../../ipc/caddy";
import type { AppError } from "../../ipc/core";
import type { GrantSummary, SelectGrantResult } from "../../ipc/grants";
import {
  legacyNoticePath,
  reduceWorkdirAction,
  workdirBlockReason,
  type WorkdirAction,
  type WorkdirLoad,
} from "./caddyWorkdirModel";

const GRANT: GrantSummary = {
  id: "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b",
  purpose: "CADDY_WORK_DIR",
  kind: "DIRECTORY",
  displayPath: "~/.caddy",
  createdAtEpochMs: 1_760_000_000_000,
};

const UNAUTHORIZED: CaddyWorkdirStatus = {
  defaultDisplayPath: "~/.caddy",
  legacyDataPresent: false,
};

const AUTHORIZED: CaddyWorkdirStatus = { ...UNAUTHORIZED, authorized: GRANT };

const LEGACY: CaddyWorkdirStatus = {
  ...AUTHORIZED,
  legacyDataPresent: true,
  legacyDisplayPath: "~/Library/Application Support/UserHome/caddy",
};

const DENIED: AppError = {
  code: "PERMISSION_DENIED",
  message: "受保护目录不能用作工作目录。",
  retryable: false,
};

function ready(workdir: CaddyWorkdirStatus): WorkdirLoad {
  return { status: "ready", workdir };
}

describe("work directory block reason", () => {
  it("explains a missing work directory once the status is known", () => {
    expect(workdirBlockReason(ready(UNAUTHORIZED))).toBe("请先选择工作目录");
  });

  it("does not block when a work directory is authorized", () => {
    expect(workdirBlockReason(ready(AUTHORIZED))).toBeUndefined();
    expect(workdirBlockReason(ready(LEGACY))).toBeUndefined();
  });

  it("does not claim the directory is missing while loading or when the status cannot be read", () => {
    expect(workdirBlockReason({ status: "loading" })).toBe("正在检查工作目录");
    expect(workdirBlockReason({ status: "failed", error: DENIED })).toBe("无法读取工作目录状态");
  });
});

describe("legacy data notice", () => {
  it("shows the old location only while legacy data is present and not dismissed", () => {
    expect(legacyNoticePath(ready(LEGACY), false)).toBe(
      "~/Library/Application Support/UserHome/caddy",
    );
    expect(legacyNoticePath(ready(LEGACY), true)).toBeUndefined();
    expect(legacyNoticePath(ready(AUTHORIZED), false)).toBeUndefined();
    expect(legacyNoticePath({ status: "loading" }, false)).toBeUndefined();
  });
});

describe("work directory action state", () => {
  const idle: WorkdirAction = { status: "idle" };

  it("asks for confirmation before revoking and returns to idle on cancel", () => {
    const asking = reduceWorkdirAction(idle, { type: "confirmRevoke" });
    expect(asking).toEqual({ status: "confirmRevoke" });
    expect(reduceWorkdirAction(asking, { type: "cancelRevoke" })).toEqual(idle);
  });

  it("does not open the revoke confirmation while another operation runs", () => {
    const busy = reduceWorkdirAction(idle, { type: "started", operation: "select" });
    expect(reduceWorkdirAction(busy, { type: "confirmRevoke" })).toBe(busy);
  });

  it("reports a cancelled picker without claiming a change", () => {
    const result: SelectGrantResult = { status: "CANCELLED" };
    expect(reduceWorkdirAction(idle, { type: "selected", result })).toEqual({
      status: "notice",
      message: "已取消，工作目录未更改。",
    });
  });

  it("reports the selected directory by its display path", () => {
    const result: SelectGrantResult = { status: "SELECTED", grant: GRANT };
    expect(reduceWorkdirAction(idle, { type: "selected", result })).toEqual({
      status: "notice",
      message: "已设置工作目录：~/.caddy",
    });
  });

  it("keeps the backend message of a failed operation", () => {
    const busy = reduceWorkdirAction(idle, { type: "started", operation: "default" });
    expect(reduceWorkdirAction(busy, { type: "failed", error: DENIED })).toEqual({
      status: "failed",
      message: "受保护目录不能用作工作目录。",
    });
  });

  it("reports a revoke and says the rules stay in place", () => {
    expect(reduceWorkdirAction(idle, { type: "revoked" })).toEqual({
      status: "notice",
      message: "已撤销工作目录授权。规则文件保留在原目录。",
    });
  });
});
