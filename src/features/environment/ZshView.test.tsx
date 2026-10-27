import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AppError } from "../../ipc/core";
import type {
  ZshEntryRow,
  ZshFile,
  ZshFileKey,
  ZshOrderStep,
  ZshOverview,
  ZshRow,
  ZshZdotdir,
} from "../../ipc/environment";
import { INITIAL_LAZY_VALUE } from "./environmentModel";
import { LazySecretValueBody } from "./LazySecretValue";
import { ZshView, type ZshViewProps } from "./ZshView";
import { INITIAL_ZSH_STATE, type ZshState } from "./zshModel";

const ERROR: AppError = { code: "PERMISSION_DENIED", message: "无法读取主目录。", retryable: true };

const ORDER: ZshOrderStep[] = [
  { position: 1, scope: "SYSTEM", pathLabel: "/etc/zshenv", appliesTo: "ALL", readByUserHome: false },
  { position: 2, scope: "USER", pathLabel: "~/.zshenv", appliesTo: "ALL", file: "ZSHENV", readByUserHome: true },
  { position: 3, scope: "SYSTEM", pathLabel: "/etc/zprofile", appliesTo: "LOGIN", readByUserHome: false },
  { position: 4, scope: "USER", pathLabel: "~/.zprofile", appliesTo: "LOGIN", file: "ZPROFILE", readByUserHome: true },
  { position: 5, scope: "SYSTEM", pathLabel: "/etc/zshrc", appliesTo: "INTERACTIVE", readByUserHome: false },
  { position: 6, scope: "USER", pathLabel: "~/.zshrc", appliesTo: "INTERACTIVE", file: "ZSHRC", readByUserHome: true },
  { position: 7, scope: "SYSTEM", pathLabel: "/etc/zlogin", appliesTo: "LOGIN", readByUserHome: false },
  { position: 8, scope: "USER", pathLabel: "~/.zlogin", appliesTo: "LOGIN", file: "ZLOGIN", readByUserHome: true },
];

function entry(overrides: Partial<ZshEntryRow> = {}): ZshEntryRow {
  return {
    kind: "ENTRY",
    line: 1,
    endLine: 1,
    name: "EDITOR",
    exported: true,
    operation: "SET",
    secret: false,
    hasValue: true,
    valueLength: 3,
    value: "vim",
    state: "STATIC",
    ...overrides,
  };
}

function ready(rows: readonly ZshRow[], overrides: Record<string, unknown> = {}): ZshFile["outcome"] {
  return {
    status: "READY",
    contentHash: "a".repeat(64),
    sizeBytes: 2048,
    lineCount: rows.length,
    rows,
    rowsTruncated: false,
    entryCount: rows.filter((row) => row.kind === "ENTRY").length,
    secretCount: 0,
    dynamicCount: 0,
    unrecognizedCount: 0,
    ...overrides,
  } as ZshFile["outcome"];
}

const NOT_FOUND: ZshFile["outcome"] = {
  status: "UNAVAILABLE",
  reason: "NOT_FOUND",
  message: "文件不存在或已被移动。",
};

const NAMES = { ZSHENV: ".zshenv", ZPROFILE: ".zprofile", ZSHRC: ".zshrc", ZLOGIN: ".zlogin" } as const;
const APPLIES = { ZSHENV: "ALL", ZPROFILE: "LOGIN", ZSHRC: "INTERACTIVE", ZLOGIN: "LOGIN" } as const;
const POSITIONS = { ZSHENV: 2, ZPROFILE: 4, ZSHRC: 6, ZLOGIN: 8 } as const;

function file(key: ZshFileKey, outcome: ZshFile["outcome"], displayPath?: string): ZshFile {
  const path = displayPath ?? `~/${NAMES[key]}`;
  return {
    file: key,
    name: NAMES[key],
    appliesTo: APPLIES[key],
    position: POSITIONS[key],
    ...(outcome.status === "NOT_LOCATED" ? {} : { displayPath: path }),
    outcome,
  };
}

function overview(
  files: readonly ZshFile[],
  zdotdir: ZshZdotdir = { status: "DEFAULT" },
): ZshOverview {
  return {
    source: { url: "https://zsh.sourceforge.io/Doc/Release/Files.html", consultedOn: "2026-10-15" },
    order: ORDER,
    zdotdir,
    files,
  };
}

function readyState(value: ZshOverview, patch: Partial<ZshState> = {}): ZshState {
  return { load: { status: "ready", requestId: 1, overview: value }, ...patch };
}

function render(state: ZshState, overrides: Partial<ZshViewProps> = {}): string {
  return renderToStaticMarkup(
    <ZshView
      choosing={false}
      onChooseDirectory={() => undefined}
      onClearDirectory={() => undefined}
      onLoadValue={() => Promise.resolve("never")}
      onReload={() => undefined}
      state={state}
      {...overrides}
    />,
  );
}

const FULL = overview([
  file("ZSHENV", ready([entry({ name: "EDITOR", value: "vim", line: 1 })])),
  file("ZPROFILE", NOT_FOUND),
  file(
    "ZSHRC",
    ready(
      [
        { kind: "COMMENT", line: 1, text: "# my setup", withheld: false },
        { kind: "BLANK", line: 2 },
        entry({ name: "EDITOR", value: "nano", line: 3, endLine: 3 }),
        entry({
          name: "PATH",
          line: 4,
          endLine: 4,
          value: "/opt/bin:$PATH::$(brew --prefix)/bin",
          valueLength: 36,
          state: "DYNAMIC",
          reason: "COMMAND_SUBSTITUTION",
          pathSegments: [
            { text: "/opt/bin", state: "STATIC" },
            { text: "$PATH", state: "REFERENCE" },
            { text: "", state: "STATIC" },
            { text: "$(brew --prefix)/bin", state: "DYNAMIC" },
          ],
        }),
        entry({
          name: "GITHUB_TOKEN",
          line: 5,
          endLine: 5,
          secret: true,
          value: undefined,
          valueLength: 12,
        }),
        entry({
          name: "WORKDIR",
          line: 6,
          endLine: 6,
          value: "$HOME/work",
          valueLength: 10,
          state: "REFERENCE",
        }),
        { kind: "DYNAMIC", line: 7, endLine: 9, reason: "CONDITIONAL", text: "if [[ -f x ]]; then", withheld: false },
        { kind: "DYNAMIC", line: 10, endLine: 10, reason: "SOURCE", withheld: true },
        { kind: "UNRECOGNIZED", line: 11, endLine: 11, text: "setopt autocd", withheld: false },
      ],
      { secretCount: 1, dynamicCount: 3, unrecognizedCount: 1 },
    ),
  ),
  file("ZLOGIN", { status: "OUTSIDE_HOME", message: "该文件解析到主目录之外，未读取、未跟随。" }),
]);

describe("zsh view states", () => {
  it("shows loading, error and the retry button", () => {
    const loading = render(INITIAL_ZSH_STATE);
    expect(loading).toContain("正在读取 zsh 启动文件");
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toMatch(/disabled=""[^>]*>读取中…/);

    const failed = render({ load: { status: "error", requestId: 1, error: ERROR } });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("无法读取主目录。");
    expect(failed).toContain("重试");
  });

  it("keeps showing the previous overview while it reloads", () => {
    const markup = render({ load: { status: "loading", requestId: 2, previous: FULL } });
    expect(markup).toContain("正在重新读取");
    expect(markup).toContain("读取顺序");
    expect(markup).toContain(".zshrc");
  });

  it("is empty when none of the four files exists", () => {
    const markup = render(
      readyState(
        overview([file("ZSHENV", NOT_FOUND), file("ZPROFILE", NOT_FOUND), file("ZSHRC", NOT_FOUND), file("ZLOGIN", NOT_FOUND)]),
      ),
    );
    expect(markup).toContain("四个启动文件都不存在");
    expect(markup).not.toContain("部分文件没有读取");
  });

  it("states the static-reading limit once on the page", () => {
    const markup = render(readyState(FULL));
    expect(markup.match(/不等于实际生效/g)).toHaveLength(1);
    expect(markup).not.toContain("是否真的生效");
    expect(markup).not.toContain("静态读取看不到");
  });

  it("is partial when a file could not be read", () => {
    const markup = render(readyState(FULL));
    expect(markup).toContain("部分文件没有读取：.zlogin：越界，未读取");
    expect(markup).toContain("越界，未读取");
    expect(markup).toContain("该文件不存在，zsh 会跳过它。");
  });

  it("reports a truncated file as partial", () => {
    const rows = [entry()];
    const markup = render(
      readyState(
        overview([file("ZSHRC", ready(rows, { rowsTruncated: true, lineCount: 9000 }))]),
      ),
    );
    expect(markup).toContain("只显示前 1 行（共 9000 行）");
  });

  it("shows an empty file as empty", () => {
    const markup = render(readyState(overview([file("ZSHRC", ready([]))])));
    expect(markup).toContain("文件是空的。");
  });
});

describe("zsh view order and applicability", () => {
  const markup = render(readyState(FULL));

  it("cites the official documentation with the consulted date", () => {
    expect(markup).toContain("来源：官方文档，2026-10-15 查阅");
    expect(markup).toContain("https://zsh.sourceforge.io/Doc/Release/Files.html");
  });

  it("lists the eight steps in order and marks system files as not read", () => {
    const labels = [...markup.matchAll(/第 (\d) 步/g)].map((match) => match[1]);
    expect(labels.slice(0, 8)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    for (const path of ["/etc/zshenv", "/etc/zprofile", "/etc/zshrc", "/etc/zlogin"]) {
      expect(markup).toContain(path);
    }
    expect(markup.match(/系统级，未读取/g)).toHaveLength(4);
  });

  it("shows which shells read each file", () => {
    expect(markup).toContain("所有 zsh");
    expect(markup).toContain("仅登录 shell");
    expect(markup).toContain("仅交互 shell");
    expect(markup).toContain("每次启动 zsh 都会读取");
  });

  it("aligns the reading order as a table with four fixed columns", () => {
    expect(markup).toContain('<table aria-label="zsh 启动文件读取顺序"');
    const order = markup.slice(markup.indexOf('<table aria-label="zsh 启动文件读取顺序"'));
    expect(order.slice(0, order.indexOf("</table>")).match(/<col[\s/>]/g)).toHaveLength(4);
    for (const label of ["步骤", "路径", "范围", "状态"]) {
      expect(markup).toContain(`>${label}</th>`);
    }
  });

  it("says the reading is static and not an evaluation", () => {
    expect(markup).toContain("不启动 shell、不 source、不执行任何文件");
    expect(markup).toContain("不等于实际生效的环境");
  });
});

describe("zsh view ZDOTDIR", () => {
  const unlocated = (zdotdir: ZshZdotdir, extra?: Partial<ZshState>, overrides?: Partial<ZshViewProps>) =>
    render(
      readyState(
        overview(
          [
            file("ZSHENV", ready([])),
            file("ZPROFILE", { status: "NOT_LOCATED", message: "ZDOTDIR 未确定，位置未知，未读取。" }),
            file("ZSHRC", { status: "NOT_LOCATED", message: "ZDOTDIR 未确定，位置未知，未读取。" }),
            file("ZLOGIN", { status: "NOT_LOCATED", message: "ZDOTDIR 未确定，位置未知，未读取。" }),
          ],
          zdotdir,
        ),
        extra,
      ),
      overrides,
    );

  it("asks the user to choose when it cannot be determined", () => {
    const markup = unlocated({ status: "UNDETERMINED", reason: "DYNAMIC" });
    expect(markup).toContain("ZDOTDIR：未确定");
    expect(markup).toContain("选择 ZDOTDIR 目录…");
    expect(markup).toContain("只能选择主目录之下的目录");
    expect(markup).toContain("位置未确定，未读取");
    expect(markup).toContain("位置未确定");
    expect(markup).toContain("UserHome 不读取自身进程的 ZDOTDIR");
    expect(markup).not.toContain("清除选择");
  });

  it("disables the choice while the picker is open", () => {
    const markup = unlocated({ status: "UNDETERMINED", reason: "MULTIPLE" }, undefined, { choosing: true });
    expect(markup).toMatch(/disabled=""[^>]*>等待选择…/);
  });

  it("shows why a chosen directory was unusable", () => {
    const markup = unlocated({
      status: "UNDETERMINED",
      reason: "DYNAMIC",
      selectionProblem: "所选目录的授权已失效",
    });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("所选目录的授权已失效");
  });

  it("marks the chosen directory as the user's choice and lets them clear it", () => {
    const markup = render(
      readyState(
        overview([file("ZSHRC", ready([entry()]), "~/.config/zsh/.zshrc")], {
          status: "SELECTED",
          displayPath: "~/.config/zsh",
        }),
        { zdotdirGrantId: "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b" },
      ),
    );
    expect(markup).toContain("ZDOTDIR：由你选择");
    expect(markup).toContain("不代表 zsh 实际使用该目录");
    expect(markup).toContain("重新选择目录…");
    expect(markup).toContain("清除选择");
    expect(markup).toContain("~/.config/zsh/.zshrc");
  });

  it("offers no choice when ZDOTDIR is default, static or outside home", () => {
    for (const zdotdir of [
      { status: "DEFAULT" },
      { status: "STATIC", displayPath: "~/.config/zsh", line: 2 },
      { status: "OUTSIDE", displayPath: "/opt/zsh", line: 2 },
    ] as const) {
      const markup = render(readyState(overview([file("ZSHRC", ready([]))], zdotdir)));
      expect(markup).not.toContain("选择 ZDOTDIR 目录…");
      expect(markup).not.toContain("清除选择");
    }
    expect(
      render(readyState(overview([], { status: "OUTSIDE", displayPath: "/opt/zsh", line: 2 }))),
    ).toContain("ZDOTDIR：越界，未读取");
    expect(
      render(readyState(overview([], { status: "STATIC", displayPath: "~/.config/zsh", line: 2 }))),
    ).toContain("第 2 行把 ZDOTDIR 设为 ~/.config/zsh");
  });
});

describe("zsh view entries", () => {
  const markup = render(readyState(FULL));

  it("shows references and dynamic values with their state in the variable table", () => {
    expect(markup).toContain("含引用（未解析）");
    expect(markup).toContain("动态／未解析");
    expect(markup).toContain("$HOME/work");
    expect(markup).toContain("nano");
    expect(markup).toContain(">vim<");
    expect(markup).toContain("可能被后面的文件覆盖");
  });

  it("keeps PATH as written in the table and flags it as dynamic", () => {
    expect(markup).toContain("/opt/bin:$PATH::$(brew --prefix)/bin");
    expect(markup).not.toContain('aria-label="PATH 项（按书写顺序）"');
  });

  it("marks dynamic statements and keeps unrecognized lines as written", () => {
    expect(markup).toContain("条件语句");
    expect(markup).toContain("第 7–9 行");
    expect(markup).toContain("source 其他文件");
    expect(markup).toContain("未识别行，保持原样");
    expect(markup).toContain("setopt autocd");
    expect(markup).toContain("（空行）");
    expect(markup).toContain("# my setup");
    expect(markup).toContain("1 行未识别");
    expect(markup).toContain("3 处动态／未解析");
  });

  it("masks secrets, never prints a value, and withholds secret-looking text", () => {
    expect(markup).toContain("秘密");
    expect(markup).toContain("GITHUB_TOKEN");
    expect(markup).toContain("载入 GITHUB_TOKEN 的值");
    expect(markup).toContain("（疑似含秘密，内容已隐藏）");
    expect(markup).toContain("1 项已遮盖");
  });

  it("hands a loaded value to the shared SecretValue, still masked", () => {
    const body = renderToStaticMarkup(
      <LazySecretValueBody
        label="GITHUB_TOKEN"
        onFetch={() => undefined}
        state={{ status: "ready", value: "ghp-plain-123" }}
      />,
    );
    expect(body).toContain('data-secret-state="masked"');
    expect(body).not.toContain("ghp-plain-123");
    expect(renderToStaticMarkup(<LazySecretValueBody label="X" onFetch={() => undefined} state={INITIAL_LAZY_VALUE} />)).toContain("载入值");
  });

  it("shows the empty value and long values that must be fetched", () => {
    const rendered = render(
      readyState(
        overview([
          file(
            "ZSHRC",
            ready([
              entry({ name: "EMPTY", hasValue: false, value: undefined, valueLength: 0 }),
              entry({ name: "BIG", value: undefined, valueLength: 5000, line: 2, endLine: 2 }),
            ]),
          ),
        ]),
      ),
    );
    expect(rendered).toContain("（空值）");
    expect(rendered).toContain("载入 BIG 的值");
  });
});

describe("zsh view same names", () => {
  it("no longer lists a separate same-name section", () => {
    const markup = render(readyState(FULL));
    expect(markup).not.toContain("同名项对照");
    expect(markup).not.toContain("这里不判断");
  });

  it("omits the separate section when no name repeats", () => {
    const markup = render(
      readyState(overview([file("ZSHENV", ready([entry({ name: "A" })])), file("ZSHRC", ready([entry({ name: "B" })]))])),
    );
    expect(markup).not.toContain("同名项对照");
  });
});

describe("zsh view is read only and accessible", () => {
  const markup = render(readyState(FULL));

  it("offers no editing, saving or text input", () => {
    for (const word of ["编辑", "保存", "新建", "删除", "写入", "添加变量"]) {
      expect(markup).not.toContain(word);
    }
    // The only field is the read-only search box of the variable list.
    const fields = markup.match(/<(input|textarea|select)\b[^>]*>/g) ?? [];
    expect(fields.every((tag) => tag.includes('type="search"'))).toBe(true);
    expect(markup).not.toMatch(/<(textarea|select)\b/);
  });

  it("puts the variable table first and keeps the reading order in a collapsed section below it", () => {
    const table = markup.indexOf('aria-labelledby="zsh-variables-heading"');
    const details = markup.indexOf("<details");
    expect(table).toBeGreaterThan(-1);
    expect(table).toBeLessThan(details);
    expect(markup.slice(details, details + 200)).toContain("读取顺序");
    expect(markup.slice(details, details + 40)).not.toContain(" open");
  });

  it("uses labelled regions, native buttons and a focusable scroll list", () => {
    expect(markup).toContain('aria-labelledby="zsh-heading"');
    expect(markup).toContain('aria-labelledby="zsh-order-heading"');
    expect(markup).toContain('aria-labelledby="zsh-zdotdir-heading"');
    expect(markup).toContain('aria-labelledby="zsh-file-ZSHRC"');
    expect(markup).toContain('aria-label=".zshrc 的内容"');
    expect(markup).toMatch(/aria-label="\.zshrc 的内容"[^>]*tabindex="0"|tabindex="0"[^>]*aria-label="\.zshrc 的内容"/);
    expect(markup).toContain("<button");
    expect(markup).toContain('aria-label="第 1 行"');
  });

  it("styles with theme tokens only, so light and dark both work", () => {
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(markup).not.toMatch(/\b(bg|text|border)-(white|black|gray|slate|zinc|red|green|blue|yellow)-\d/);
    expect(markup).not.toMatch(/<section[^>]*class="[^"]*bg-surface-muted/);
    expect(markup).not.toMatch(/class="[^"]*\bborder-b border-border/);
    expect(markup).toContain("text-muted-foreground");
  });
});
