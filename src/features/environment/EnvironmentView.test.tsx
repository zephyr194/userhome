/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AppError } from "../../ipc/core";
import type {
  EnvFileOutcome,
  EnvFileView,
  EnvRow,
  ScanOutcome,
} from "../../ipc/environment";
import type { GrantSummary } from "../../ipc/grants";
import { EnvironmentView, type EnvironmentViewProps } from "./EnvironmentView";
import {
  INITIAL_ENVIRONMENT_STATE,
  INITIAL_LAZY_VALUE,
  type EnvironmentState,
} from "./environmentModel";
import { LazySecretValueBody } from "./LazySecretValue";

const GRANT_ID = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
const GRANT: GrantSummary = {
  id: GRANT_ID,
  purpose: "CONFIG_DIRECTORY",
  kind: "DIRECTORY",
  displayPath: "~/work/proj",
  createdAtEpochMs: 1,
};
const SETTINGS = { patterns: [".env", ".env.*", "*.env"], recursive: false };
const ERROR: AppError = { code: "NOT_FOUND", message: "授权已被撤销。", retryable: false };

const SCAN: ScanOutcome = {
  root: "~/work/proj",
  recursive: true,
  patterns: SETTINGS.patterns,
  files: [
    { relativePath: ".env", name: ".env", kind: "ENVIRONMENT", sizeBytes: 120, oversized: false, symlink: false },
    { relativePath: "app/.env.example", name: ".env.example", kind: "TEMPLATE", sizeBytes: 40, oversized: false, symlink: false },
    { relativePath: "big.env", name: "big.env", kind: "ENVIRONMENT", sizeBytes: 3 * 1024 * 1024, oversized: true, symlink: true },
  ],
  skipped: [
    { relativePath: ".env.link", reason: "OUTSIDE_LINK" },
    { reason: "INVALID_NAME" },
  ],
  skippedTotal: 3,
  excludedDirectories: 2,
  partialReasons: ["DEPTH_LIMIT", "MATCH_LIMIT"],
  entriesExamined: 30,
  limits: { maxDepth: 5, maxEntries: 2000, maxMatches: 200, maxFileBytes: 1048576 },
  exclusions: [".git", "node_modules"],
};

function entry(overrides: Partial<Extract<EnvRow, { kind: "ENTRY" }>> = {}): EnvRow {
  return {
    kind: "ENTRY",
    line: 2,
    endLine: 2,
    key: "PORT",
    exported: false,
    secret: false,
    hasValue: true,
    valueLength: 4,
    value: "3000",
    quote: "NONE",
    flags: [],
    ...overrides,
  };
}

function fileView(rows: EnvRow[], overrides: Partial<EnvFileView> = {}): EnvFileOutcome {
  return {
    status: "READY",
    file: {
      relativePath: ".env",
      kind: "ENVIRONMENT",
      contentHash: "a".repeat(64),
      sizeBytes: 100,
      lineCount: rows.length,
      rows,
      rowsTruncated: false,
      entryCount: rows.filter((row) => row.kind === "ENTRY").length,
      secretCount: 1,
      flaggedCount: 2,
      ...overrides,
    },
  };
}

function stateOf(patch: Partial<EnvironmentState> = {}): EnvironmentState {
  return {
    ...INITIAL_ENVIRONMENT_STATE,
    grants: { status: "ready", grants: [GRANT] },
    selectedGrantId: GRANT_ID,
    ...patch,
  };
}

function render(
  state: EnvironmentState,
  overrides: Partial<EnvironmentViewProps> = {},
): string {
  return renderToStaticMarkup(
    <EnvironmentView
      addingGrant={false}
      onAddGrant={() => undefined}
      onLoadValue={() => Promise.resolve("never")}
      onPatternsChange={() => undefined}
      onRecursiveChange={() => undefined}
      onReloadGrants={() => undefined}
      onRevokeGrant={() => undefined}
      onScan={() => undefined}
      onSelectFile={() => undefined}
      onSelectGrant={() => undefined}
      state={state}
      {...overrides}
    />,
  );
}

const READY_SCAN = {
  status: "ready",
  requestId: 1,
  outcome: SCAN,
  settings: SETTINGS,
} as const;

describe("directory authorizations", () => {
  it("shows the loading, error and empty states", () => {
    expect(render({ ...INITIAL_ENVIRONMENT_STATE })).toContain("正在读取目录授权");

    const failed = render({
      ...INITIAL_ENVIRONMENT_STATE,
      grants: { status: "error", error: ERROR },
    });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("授权已被撤销。");
    expect(failed).toContain("重试");

    const empty = render(
      stateOf({ grants: { status: "ready", grants: [] }, selectedGrantId: undefined }),
    );
    expect(empty).toContain("还没有授权目录");
    expect(empty).toContain("添加目录授权");
    expect(empty).toContain("先添加并选择一个目录授权");
  });

  it("lists authorized directories with selection and revoke controls", () => {
    const markup = render(stateOf());

    expect(markup).toContain("~/work/proj");
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("撤销 ~/work/proj 的授权");
    expect(markup).toContain("从不执行或 source");
    expect(markup).not.toContain("/Users/");
  });

  it("shows the picker notice and disables adding while waiting", () => {
    const markup = render(stateOf(), {
      addingGrant: true,
      grantNotice: { tone: "error", text: "该位置受保护，不能授权。" },
    });

    expect(markup).toContain("等待选择…");
    expect(markup).toContain("该位置受保护，不能授权。");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>等待选择…/);
  });
});

describe("scan settings", () => {
  it("starts with the three default patterns, local only, and states the limits", () => {
    const markup = render(stateOf());

    expect(markup).toContain(".env\n.env.*\n*.env");
    expect(markup).toContain("递归扫描子目录");
    for (const limit of ["5 层", "2000", "200", "1 MiB"]) {
      expect(markup).toContain(limit);
    }
    expect(markup).toContain("不是 shell 或正则");
    expect(markup).toContain("扫描");
  });

  it("explains an invalid pattern and keeps scanning disabled", () => {
    const markup = render(stateOf({ patternsText: "../.env" }));

    expect(markup).toContain("不能含空段、. 或 .. 段");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>扫描<\/button>/);
  });

  it("cannot scan without a selected directory", () => {
    const markup = render(stateOf({ selectedGrantId: undefined }));
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>扫描<\/button>/);
  });

  it("tells when the settings changed after the last scan", () => {
    const markup = render(
      stateOf({ scan: READY_SCAN, patternsText: "*.secrets" }),
    );
    expect(markup).toContain("设置已更改，重新扫描后生效");
  });
});

describe("scan results", () => {
  it("shows idle, loading and error states", () => {
    expect(render(stateOf())).toContain("点击“扫描”列出匹配的环境文件");
    expect(render(stateOf({ scan: { status: "loading", requestId: 1 } }))).toContain("正在扫描");
    const failed = render(
      stateOf({ scan: { status: "error", requestId: 1, error: ERROR } }),
    );
    expect(failed).toContain("授权已被撤销。");
    expect(failed).toContain('role="alert"');
  });

  it("lists files with template, link and size markers and the root", () => {
    const markup = render(stateOf({ scan: READY_SCAN }));

    expect(markup).toContain("根目录 ~/work/proj · 递归 · 共 3 个文件");
    expect(markup).toContain("app/.env.example");
    expect(markup).toContain("模板");
    expect(markup).toContain("符号链接");
    expect(markup).toContain("过大");
    expect(markup).toContain("3.0 MiB");
  });

  it("marks a partial result and names each reason", () => {
    const markup = render(stateOf({ scan: READY_SCAN }));

    expect(markup).toContain("这是部分结果，不是完整列表");
    expect(markup).toContain("深度上限（5 层）");
    expect(markup).toContain("匹配上限（200 个文件）");
  });

  it("does not claim partiality for a complete result and reports an empty one", () => {
    const markup = render(
      stateOf({
        scan: {
          ...READY_SCAN,
          outcome: { ...SCAN, files: [], partialReasons: [] },
        },
      }),
    );

    expect(markup).not.toContain("这是部分结果");
    expect(markup).toContain("没有匹配的环境文件");
  });

  it("reports exclusions and refused links, including names that cannot be shown", () => {
    const markup = render(stateOf({ scan: READY_SCAN }));

    expect(markup).toContain("排除规则与已跳过项（3）");
    expect(markup).toContain(".env.link：符号链接指向授权目录之外，已拒绝");
    expect(markup).toContain("（名称无法显示）");
    expect(markup).toContain("还有 1 项未列出");
    expect(markup).toContain(".git、node_modules");
  });
});

describe("file view", () => {
  const loaded = (outcome: EnvFileOutcome): EnvironmentState =>
    stateOf({
      scan: READY_SCAN,
      selectedPath: ".env",
      file: { status: "loaded", requestId: 2, path: ".env", outcome },
    });

  it("shows idle, loading and error states", () => {
    expect(render(stateOf())).toContain("选择左侧的文件查看其内容");
    expect(
      render(stateOf({ file: { status: "loading", requestId: 1, path: "a/.env" } })),
    ).toContain("正在读取 a/.env");
    const failed = render(
      stateOf({ file: { status: "error", requestId: 1, path: ".env", error: ERROR } }),
    );
    expect(failed).toContain("授权已被撤销。");
  });

  it.each([
    ["NOT_FOUND", "文件不存在"],
    ["PERMISSION_DENIED", "无权限读取"],
    ["MALFORMED", "格式错误"],
    ["TOO_LARGE", "文件过大"],
    ["UNSUPPORTED", "不支持"],
    ["EXCLUDED", "已排除或授权已失效"],
  ] as const)("shows a %s failure instead of an empty file", (reason, label) => {
    const markup = render(
      loaded({ status: "UNAVAILABLE", reason, message: "后端说明" }),
    );

    expect(markup).toContain(label);
    expect(markup).toContain("后端说明");
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain("文件是空的");
  });

  it("renders comments, unknown lines, blanks and conflict markers", () => {
    const markup = render(
      loaded(
        fileView([
          { kind: "COMMENT", line: 1, text: "# service settings", withheld: false },
          entry({ line: 2, flags: ["DUPLICATE_KEY"] }),
          { kind: "BLANK", line: 3 },
          entry({ line: 4, key: "HOME_DIR", value: "$HOME/app", valueLength: 9, flags: ["INTERPOLATION"] }),
          { kind: "UNKNOWN", line: 5, text: "NAME = loose", withheld: false },
          entry({ line: 6, endLine: 7, key: "NOTE", value: "two\nlines", valueLength: 9, flags: ["MULTILINE_VALUE"] }),
          entry({ line: 8, key: "CMD", value: "$(id)", valueLength: 5, flags: ["COMMAND_SUBSTITUTION"] }),
          { kind: "COMMENT", line: 9, withheld: true },
        ]),
      ),
    );

    expect(markup).toContain("# service settings");
    expect(markup).toContain("（空行）");
    expect(markup).toContain("未识别行，保持原样");
    expect(markup).toContain("NAME = loose");
    expect(markup).toContain("冲突：重复键");
    expect(markup).toContain("动态：变量插值");
    expect(markup).toContain("动态：命令替换");
    expect(markup).toContain("不支持：多行值");
    expect(markup).toContain("没有执行");
    expect(markup).toContain("第 6–7 行");
    expect(markup).toContain("（疑似含秘密，内容已隐藏）");
    expect(markup).toContain("$HOME/app");
    expect(markup).toContain("2 项需注意");
  });

  it("masks secrets and shows nothing but a load control", () => {
    const markup = render(
      loaded(
        fileView([
          entry({ line: 1, key: "API_TOKEN", secret: true, value: undefined, valueLength: 14 }),
          entry({ line: 2, key: "LONG_VALUE", value: undefined, valueLength: 9000 }),
        ]),
      ),
    );

    expect(markup).toContain("载入 API_TOKEN 的值");
    expect(markup).toContain("载入 LONG_VALUE 的值");
    expect(markup).toContain("••••••••");
    expect(markup).toContain("已隐藏，值尚未载入");
    expect(markup).toContain("秘密");
    expect(markup).toContain("1 项已遮盖");
  });

  it("shows plain values and empty values directly", () => {
    const markup = render(
      loaded(
        fileView([
          entry({ line: 1, key: "PORT", value: "3000" }),
          entry({ line: 2, key: "EMPTY", hasValue: false, valueLength: 0, value: "" }),
        ]),
      ),
    );

    expect(markup).toContain("3000");
    expect(markup).toContain("（空值）");
    expect(markup).not.toContain("载入 PORT");
  });

  it("labels templates and reports truncated rows", () => {
    const markup = render(
      loaded(
        fileView([entry()], {
          kind: "TEMPLATE",
          relativePath: ".env.example",
          rowsTruncated: true,
          lineCount: 6000,
        }),
      ),
    );

    expect(markup).toContain("模板文件");
    expect(markup).toContain("不会与真实环境文件合并成运行时值");
    expect(markup).toContain("只显示前 1 行（共 6000 行）");
    expect(markup).toContain("没有通用优先级");
  });

  it("reports an empty file as empty, not as a failure", () => {
    const markup = render(loaded(fileView([], { entryCount: 0, secretCount: 0, flaggedCount: 0 })));
    expect(markup).toContain("文件是空的");
  });
});

describe("lazily loaded secret", () => {
  const body = (state: Parameters<typeof LazySecretValueBody>[0]["state"]) =>
    renderToStaticMarkup(
      <LazySecretValueBody label="API_TOKEN" onFetch={() => undefined} state={state} />,
    );

  it("starts masked with an explicit load button", () => {
    const markup = body(INITIAL_LAZY_VALUE);
    expect(markup).toContain("载入 API_TOKEN 的值");
    expect(markup).toContain("载入值");
    expect(markup).toContain("••••••••");
  });

  it("disables the button while loading and reports a failure", () => {
    expect(body({ status: "loading" })).toMatch(/disabled=""[^>]*>载入中…/);
    const failed = body({ status: "failed", message: "文件已变化" });
    expect(failed).toContain("载入失败：文件已变化");
    expect(failed).toContain('role="status"');
  });

  it("hands a loaded value to the shared SecretValue, still masked", () => {
    const markup = body({ status: "ready", value: "tok-plain-123" });

    expect(markup).toContain('data-secret-state="masked"');
    expect(markup).toContain("显示 API_TOKEN 的值");
    expect(markup).toContain("复制 API_TOKEN 的值");
    expect(markup).not.toContain("tok-plain-123");
  });
});

describe("environment feature sources", () => {
  const directory = join(process.cwd(), "src", "features", "environment");
  const sources = readdirSync(directory)
    .filter((name) => /\.tsx?$/.test(name) && !name.includes(".test."))
    .map((name) => [name, readFileSync(join(directory, name), "utf8")] as const);

  it("never touches browser storage", () => {
    for (const [name, source] of sources) {
      expect(source, name).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    }
  });

  it("does not log values", () => {
    for (const [name, source] of sources) {
      expect(source, name).not.toMatch(/console\.(log|debug|info|warn|error)/);
    }
  });
});

describe("分区头与扫描原因（r4-fe5）", () => {
  it("uses borderless headings for the page and every section, with no header band", () => {
    const markup = render(stateOf());
    const headers = markup.match(/<header class="[^"]*"/g) ?? [];
    expect(headers).toHaveLength(5);
    for (const header of headers) {
      expect(header).not.toContain("bg-surface-muted");
      expect(header).not.toContain("border-b");
    }
  });

  it("names the reason scanning is blocked and links it to the button", () => {
    const markup = render(stateOf({ selectedGrantId: undefined }));
    expect(markup).toContain('aria-describedby="environment-scan-reason"');
    expect(markup).toMatch(/id="environment-scan-reason"[^>]*>先添加并选择一个目录授权。</);
  });

  it("gives no blocked reason when scanning is available", () => {
    const markup = render(stateOf());
    expect(markup).not.toContain("environment-scan-reason");
  });
});
