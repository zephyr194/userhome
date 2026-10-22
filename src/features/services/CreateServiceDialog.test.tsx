/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AppError } from "../../ipc/core";
import type {
  CreateServiceExecution,
  CreateServicePreview,
} from "../../ipc/services";
import { CreateServiceDialogView } from "./CreateServiceDialog";
import {
  INITIAL_CREATE_FORM,
  type CreateDialogState,
  type CreateFormState,
} from "./createServiceModel";

const NAMESPACE = "com.zephyr194.userhome.agent.";
const FILE = `~/Library/LaunchAgents/${NAMESPACE}backup.plist`;

const PREVIEW = {
  operationId: "op-1",
  summary: `Create ${FILE}.`,
  effects: [],
  expiresAt: "2026-10-20T10:05:00Z",
  kind: "CREATE",
  recoveryPoint: "NONE_CREATED",
  target: FILE,
  proposedHash: "c".repeat(64),
  diff: { lines: [], redacted: true, truncated: false },
  label: `${NAMESPACE}backup`,
  filePath: FILE,
  executable: "/usr/local/bin/tool",
  arguments: ["--token=[REDACTED]", "--name", "x y"],
  argumentsRedacted: true,
  workingDirectory: "~/work",
  environmentKeys: ["API_KEY", "MODE"],
  stdoutPath: "~/logs/out.log",
  runAtLoad: true,
  keepAlive: false,
  persistenceNotes: [
    "登录后自动启动：已开启。任务一旦被加载就会立即启动。",
    "退出后自动重启：已关闭。任务退出后不会自动重启。",
    "参数与环境变量会以明文写入该配置文件。",
  ],
  effectNote: "仅创建配置文件，本步不加载、不启动。",
} as CreateServicePreview;

function execution(fileState = "WRITTEN", status = "SUCCEEDED") {
  return {
    operationId: "op-1",
    summary: "s",
    effects: [],
    expiresAt: "2026-10-20T10:05:00Z",
    status: "SUCCEEDED",
    events: [],
    outcome: {
      kind: "CREATE",
      status,
      fileState,
      recoveryPoint: "NONE_CREATED",
      summary: "ok",
    },
    label: `${NAMESPACE}backup`,
    filePath: FILE,
    loaded: false,
    effectNote: "配置文件已创建。新任务尚未加载，也未启动。",
  } as unknown as CreateServiceExecution;
}

function form(overrides: Partial<CreateFormState> = {}): CreateFormState {
  return {
    ...INITIAL_CREATE_FORM,
    labelSuffix: "backup",
    executable: "/usr/local/bin/tool",
    ...overrides,
  };
}

function view(
  dialog: CreateDialogState = { phase: "editing" },
  overrides: Partial<CreateFormState> = {},
  showErrors = false,
) {
  return renderToStaticMarkup(
    <CreateServiceDialogView
      form={form(overrides)}
      dialog={dialog}
      showErrors={showErrors}
      onFormChange={() => undefined}
      onPreview={() => undefined}
      onEdit={() => undefined}
      onConfirm={() => undefined}
      onClose={() => undefined}
    />,
  );
}

function buttonLabels(markup: string): string[] {
  return [...markup.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((match) =>
    match[2].replace(/<[^>]+>/g, ""),
  );
}

describe("create dialog: editing", () => {
  it("says what it does and what it does not do", () => {
    const markup = view();
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("创建 UserHome 自建任务");
    expect(markup).toContain(NAMESPACE);
    expect(markup).toContain("仅创建配置文件");
    expect(markup).toContain("不会加载或启动");
    expect(markup).toContain("不经 shell");
  });

  it("shows the form fields and the label the job will get", () => {
    const markup = view({ phase: "editing" }, { labelSuffix: "backup" });
    for (const text of [
      "任务名称",
      "可执行文件路径",
      "参数",
      "工作目录",
      "环境变量",
      "标准输出日志路径",
      "标准错误日志路径",
    ]) {
      expect(markup).toContain(text);
    }
    expect(markup).toContain(`${NAMESPACE}backup`);
    expect(buttonLabels(markup)).toEqual(
      expect.arrayContaining(["添加参数", "添加环境变量", "预览", "取消"]),
    );
  });

  it("keeps both persistence options off and explains them before they can be turned on", () => {
    const markup = view();
    expect(markup).toContain("登录后自动启动");
    expect(markup).toContain("退出后自动重启");
    expect(markup).toContain("之后每次登录都会如此");
    expect(markup).toContain("launchd 都会立即重新启动它");
    expect(markup.match(/aria-checked="true"/g)).toBeNull();
    const on = view({ phase: "editing" }, { runAtLoad: true, keepAlive: true });
    expect(on.match(/aria-checked="true"/g)).toHaveLength(2);
  });

  it("hides environment values and warns they may be secrets", () => {
    const markup = view(
      { phase: "editing" },
      { environment: [{ id: 1, key: "API_KEY", value: "s3cret-value-123" }], nextRowId: 2 },
    );
    expect(markup).toContain("可能包含密钥");
    expect(markup).toMatch(/type="password"/);
    expect(markup).toContain('autoComplete="off"');
  });

  it("lists argument rows with move and remove controls", () => {
    const markup = view(
      { phase: "editing" },
      { arguments: [{ id: 1, value: "--a" }, { id: 2, value: "--b" }], nextRowId: 3 },
    );
    expect(markup).toContain("参数 1");
    expect(markup).toContain("参数 2");
    expect(buttonLabels(markup)).toEqual(
      expect.arrayContaining(["上移", "下移", "删除参数"]),
    );
  });

  it("shows validation errors only once the user asked to preview", () => {
    const bad = { executable: "bash" };
    expect(view({ phase: "editing" }, bad, false)).not.toContain("必须是以 / 开头");
    const shown = view({ phase: "editing" }, bad, true);
    expect(shown).toContain("必须是以 / 开头");
    expect(shown).toContain('role="alert"');
  });

  it("shows a refused preview without echoing environment values", () => {
    const error: AppError = {
      code: "VALIDATION_FAILED",
      message: "环境变量名含有 s3cret-value-123 不允许的字符。",
      retryable: false,
    };
    const markup = view(
      { phase: "editing", error },
      { environment: [{ id: 1, key: "A", value: "s3cret-value-123" }], nextRowId: 2 },
    );
    expect(markup).toContain("环境变量名含有");
    expect(markup).not.toContain("s3cret-value-123</");
    expect(markup).toContain("[已隐藏]");
  });

  it("disables the preview button while the preview is being prepared", () => {
    const markup = view({ phase: "previewing" });
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*?预览/);
    expect(markup).toContain("正在生成预览");
  });
});

describe("create dialog: preview", () => {
  const markup = view({ phase: "preview", preview: PREVIEW });

  it("shows the file, the real command, the directory, env names and logs", () => {
    expect(markup).toContain(FILE);
    expect(markup).toContain(`${NAMESPACE}backup`);
    expect(markup).toContain("/usr/local/bin/tool");
    expect(markup).toContain("--token=[REDACTED]");
    expect(markup).toContain("x y");
    expect(markup).toContain("敏感参数已隐藏");
    expect(markup).toContain("~/work");
    expect(markup).toContain("API_KEY");
    expect(markup).toContain("MODE");
    expect(markup).toContain("值不会显示");
    expect(markup).toContain("~/logs/out.log");
  });

  it("states the persistence impact and that nothing is loaded or started", () => {
    expect(markup).toContain("登录后自动启动：已开启");
    expect(markup).toContain("退出后自动重启：已关闭");
    expect(markup).toContain("仅创建配置文件，本步不加载、不启动。");
  });

  it("offers a way back and the confirmation", () => {
    expect(buttonLabels(markup)).toEqual(expect.arrayContaining(["返回修改", "确认创建"]));
    expect(buttonLabels(markup)).not.toContain("预览");
  });

  it("never renders a diff or file content", () => {
    expect(markup).not.toContain("<plist");
    expect(markup).not.toContain("&lt;plist");
    expect(markup).not.toContain("ProgramArguments");
  });
});

describe("create dialog: confirmation and result", () => {
  it("is busy while creating and cannot be confirmed twice", () => {
    const markup = view({ phase: "creating", preview: PREVIEW });
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("正在创建");
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*?确认创建/);
  });

  it("reports success and that the new task is not loaded yet", () => {
    const markup = view({ phase: "done", execution: execution() });
    expect(markup).toContain("已创建配置文件");
    expect(markup).toContain(FILE);
    expect(markup).toContain("新任务尚未加载");
    expect(buttonLabels(markup)).toEqual(["完成"]);
  });

  it("reports a refused confirmation as nothing written, without environment values", () => {
    const error: AppError = {
      code: "CONFLICT",
      message: "已存在同名配置文件，不会覆盖。s3cret-value-123",
      retryable: false,
    };
    const markup = view(
      { phase: "failed", preview: PREVIEW, error },
      { environment: [{ id: 1, key: "A", value: "s3cret-value-123" }], nextRowId: 2 },
    );
    expect(markup).toContain("没有写入任何文件");
    expect(markup).toContain("已存在同名配置文件");
    expect(markup).not.toContain("s3cret-value-123");
    expect(buttonLabels(markup)).toEqual(expect.arrayContaining(["返回修改", "关闭"]));
  });

  it("reports exactly what is known when the write ran but failed", () => {
    const markup = view({
      phase: "failed",
      preview: PREVIEW,
      execution: execution("CREATED_REMOVE_FAILED", "FAILED"),
    });
    expect(markup).toContain("创建未完成");
    expect(markup).toContain("仍可能存在");
    expect(markup).not.toContain("没有写入任何文件");
  });
});

describe("create dialog sources", () => {
  const source = readFileSync(
    join(process.cwd(), "src", "features", "services", "CreateServiceDialog.tsx"),
    "utf8",
  );

  it("never touches browser storage, logs, or runs launchd actions", () => {
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(source).not.toMatch(/console\.(log|debug|info|warn|error)/);
    expect(source).not.toMatch(/launchctl|loadService|startService|unloadService/);
    // Only the preview and the confirmation of the creation are wired.
    expect(source).toContain("previewCreateLaunchdService");
    expect(source).toContain("executeCreateLaunchdService");
  });
});
