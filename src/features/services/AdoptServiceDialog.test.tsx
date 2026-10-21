import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AppError } from "../../ipc/core";
import type { AdoptExecution, AdoptPreview } from "../../ipc/servicesAdopt";
import { AdoptServiceDialogView } from "./AdoptServiceDialog";
import type { AdoptFlowState } from "./adoptServiceModel";

const LABEL = "com.vendor.backup";
const FILE = `~/Library/LaunchAgents/${LABEL}.plist`;

function buttonLabels(markup: string): string[] {
  return [...markup.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((match) =>
    match[1].replace(/<[^>]+>/g, "").trim(),
  );
}

// ---- adoption -------------------------------------------------------------

const ADOPT_PREVIEW: AdoptPreview = {
  operationId: "op-1",
  summary: `接管任务 ${LABEL}`,
  effects: [],
  requiresElevation: false,
  expiresAt: "2026-10-20T10:05:00Z",
  label: LABEL,
  domain: "GUI",
  source: "~/Library/LaunchAgents（当前用户）",
  filePath: FILE,
  backup: "执行前把原始 plist 备份到 UserHome 备份目录。",
  changedFields: [],
  externalManagerNote: "若由 Homebrew services 管理，它们可能重写此文件。",
  effectNote: "接管只记录所有权，不修改 plist 内容，也不加载或重启任务。",
};

const ADOPT_EXECUTION: AdoptExecution = {
  operationId: "op-1",
  summary: "done",
  effects: [],
  requiresElevation: false,
  expiresAt: "2026-10-20T10:05:00Z",
  status: "SUCCEEDED",
  events: [],
  label: LABEL,
  domain: "GUI",
  filePath: FILE,
  backupId: "adopt-0123456789abcdef",
  plistChanged: false,
  effectNote: "接管只记录所有权，不修改 plist 内容，也不加载或重启任务。",
};

function adoptView(flow: AdoptFlowState): string {
  return renderToStaticMarkup(
    <AdoptServiceDialogView
      flow={flow}
      onClose={() => undefined}
      onConfirm={() => undefined}
      onRetry={() => undefined}
    />,
  );
}

describe("adoption dialog", () => {
  it("shows what will be adopted, the backup, and that the plist is not changed", () => {
    const markup = adoptView({ phase: "previewed", preview: ADOPT_PREVIEW });
    expect(markup).toContain(LABEL);
    expect(markup).toContain(FILE);
    expect(markup).toContain("~/Library/LaunchAgents（当前用户）");
    expect(markup).toContain("执行前把原始 plist 备份");
    expect(markup).toContain("接管只记录所有权，不修改 plist 内容");
    expect(markup).toContain("拟变更字段：无");
    expect(markup).toContain("Homebrew services");
    expect(buttonLabels(markup)).toEqual(["取消", "确认接管"]);
  });

  it("reports a refused adoption with the backend's own reason, and offers a new preview", () => {
    const error: AppError = {
      code: "PERMISSION_DENIED",
      message: "该任务不能接管：plist 为二进制格式，无法保真编辑，已拒绝。",
      retryable: false,
    };
    const markup = adoptView({ phase: "failed", error });
    expect(markup).toContain("该任务不能接管");
    expect(markup).toContain("二进制格式");
    expect(buttonLabels(markup)).toEqual(["关闭", "重新预览"]);
  });

  it("shows the backup and the read-back result after a success", () => {
    const markup = adoptView({ phase: "done", execution: ADOPT_EXECUTION });
    expect(markup).toContain("已接管 com.vendor.backup");
    expect(markup).toContain("adopt-0123456789abcdef");
    expect(markup).toContain("回读确认");
    expect(buttonLabels(markup)).toEqual(["完成"]);
  });

  it("offers no delete or batch wording", () => {
    for (const flow of [
      { phase: "previewing" } as const,
      { phase: "previewed", preview: ADOPT_PREVIEW } as const,
      { phase: "done", execution: ADOPT_EXECUTION } as const,
    ]) {
      const markup = adoptView(flow);
      expect(markup).not.toMatch(/删除|批量|卸载|启动|停止/);
    }
  });
});
