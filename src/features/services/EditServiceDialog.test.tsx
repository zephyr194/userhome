import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EditExecution, EditPreview } from "../../ipc/servicesAdopt";
import { EditServiceDialogView } from "./EditServiceDialog";
import {
  initialEditForm,
  type EditDialogState,
  type EditFormState,
  type EditOriginal,
} from "./editServiceModel";

const LABEL = "com.vendor.backup";
const FILE = `~/Library/LaunchAgents/${LABEL}.plist`;

function buttonLabels(markup: string): string[] {
  return [...markup.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((match) =>
    match[1].replace(/<[^>]+>/g, "").trim(),
  );
}

// ---- edit -----------------------------------------------------------------


const ORIGINAL: EditOriginal = {
  label: LABEL,
  executable: "/usr/local/bin/tool",
  arguments: ["--serve"],
  environmentKeys: ["API_TOKEN", "MODE"],
  stdoutPath: "~/Library/Logs/out.log",
  runAtLoad: false,
  keepAlive: false,
  keepAliveLocked: true,
};

const EDIT_PREVIEW: EditPreview = {
  operationId: "op-7",
  kind: "REPLACE",
  recoveryPoint: "BACKUP",
  target: FILE,
  currentHash: "a".repeat(64),
  proposedHash: "b".repeat(64),
  diff: { lines: [], redacted: true, truncated: false },
  summary: "edit",
  effects: [],
  requiresElevation: false,
  expiresAt: "2026-10-20T10:05:00Z",
  label: LABEL,
  domain: "GUI",
  filePath: FILE,
  changes: ["EnvironmentVariables", "RunAtLoad"],
  environmentSet: ["NEW_FLAG"],
  environmentRemoved: ["API_TOKEN"],
  backup: "执行前把原始 plist 备份到 UserHome 备份目录。",
  reloadNote: "配置已保存，需重新加载任务才生效；本步不会加载或重启。",
};

function editExecution(overrides: Partial<EditExecution["outcome"]> = {}): EditExecution {
  return {
    operationId: "op-7",
    summary: "edit",
    effects: [],
    requiresElevation: false,
    expiresAt: "2026-10-20T10:05:00Z",
    status: overrides.status === "FAILED" ? "FAILED" : "SUCCEEDED",
    events: [],
    outcome: {
      kind: "REPLACE",
      status: "SUCCEEDED",
      fileState: "WRITTEN",
      recoveryPoint: "BACKUP",
      backupId: "backup-1",
      summary: "s",
      ...overrides,
    },
    label: LABEL,
    domain: "GUI",
    filePath: FILE,
    reloadRequired: true,
    reloadNote: EDIT_PREVIEW.reloadNote,
  };
}

function editView(
  dialog: EditDialogState,
  form: EditFormState = initialEditForm(ORIGINAL),
): string {
  return renderToStaticMarkup(
    <EditServiceDialogView
      dialog={dialog}
      errors={undefined}
      form={form}
      onClose={() => undefined}
      onConfirm={() => undefined}
      onEdit={() => undefined}
      onFormChange={() => undefined}
      onPreview={() => undefined}
      original={ORIGINAL}
    />,
  );
}

describe("edit dialog form", () => {
  it("shows the editable fields, the variable names, and the masked value inputs", () => {
    const markup = editView({ phase: "editing" });
    expect(markup).toContain("程序与参数");
    expect(markup).toContain("工作目录");
    expect(markup).toContain("清除工作目录");
    expect(markup).toContain("API_TOKEN");
    expect(markup).toContain("可能包含密钥");
    expect(markup).toContain("环境变量");
    expect(buttonLabels(markup)).toContain("预览");
  });

  it("locks KeepAlive with the reason when the plist keeps it as conditions", () => {
    const markup = editView({ phase: "editing" });
    expect(markup).toContain("KeepAlive 是按条件设置的字典");
    expect(markup).toMatch(/<input[^>]*disabled[^>]*\/?>/);
  });
});

describe("edit dialog preview", () => {
  it("names the changed fields and the environment names, and never a value", () => {
    const form: EditFormState = {
      ...initialEditForm(ORIGINAL),
      environment: [{ id: 9, key: "NEW_FLAG", value: "s3cret-value-xyz" }],
    };
    const markup = editView({ phase: "preview", preview: EDIT_PREVIEW }, form);
    expect(markup).toContain("将保存的文件");
    expect(markup).toContain("环境变量");
    expect(markup).toContain("登录后自动启动");
    expect(markup).toContain("NEW_FLAG");
    expect(markup).toContain("API_TOKEN");
    expect(markup).not.toContain("s3cret-value-xyz");
    expect(markup).toContain("需重新加载任务才生效");
    expect(markup).toContain("执行前把原始 plist 备份");
    expect(buttonLabels(markup)).toEqual(["返回修改", "确认保存"]);
  });

  it("asks for a new preview after a conflict with an external change", () => {
    const markup = editView({
      phase: "failed",
      preview: EDIT_PREVIEW,
      error: { code: "CONFLICT", message: "changed", retryable: false },
    });
    expect(markup).toContain("配置在预览后已被外部修改");
    expect(markup).toContain("请重新预览");
  });

  it("explains a write that was rolled back, and shows a saved file with its reload note", () => {
    const rolledBack = editView({
      phase: "failed",
      preview: EDIT_PREVIEW,
      execution: editExecution({ status: "FAILED", fileState: "RESTORED" }),
    });
    expect(rolledBack).toContain("已恢复原内容");

    const saved = editView({ phase: "done", execution: editExecution() });
    expect(saved).toContain("已保存配置");
    expect(saved).toContain("需重新加载任务才生效");
    expect(buttonLabels(saved)).toEqual(["完成"]);
  });
});
