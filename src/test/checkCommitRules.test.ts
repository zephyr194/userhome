/// <reference types="node" />
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

interface FileChange {
  path: string;
  added: string[];
  removed: string[];
  addedAt?: number[];
  after?: string[];
}
interface Commit {
  sha: string;
  message: string;
  files: FileChange[];
}
interface Rule {
  id: string;
  description: string;
  check: (commit: Commit) => string[];
}
interface RulesModule {
  RULES: Rule[];
  isRuleFile: (path: string) => boolean;
  isTestFile: (path: string) => boolean;
  countAssertions: (lines: string[], path: string) => number;
  countSkipMarkers: (lines: string[], path: string) => number;
  weakensAssertions: (file: FileChange) => boolean;
  parseApproval: (message: string) => string | null;
  evaluateCommit: (commit: Commit) => { rule: Rule; files: string[] }[];
  sleepViolations: (file: FileChange) => string[];
  cfgTestRanges: (lines: string[]) => [number, number][];
}

// 脚本是不带类型声明的 .mjs，用变量路径动态导入以避开 TS7016；类型由上面的接口给出。
const scriptPath = fileURLToPath(
  new URL("../../scripts/check-commit-rules.mjs", import.meta.url),
);
const rules = (await import(/* @vite-ignore */ scriptPath)) as RulesModule;
const repoRoot = dirname(dirname(scriptPath));

function runScript(args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync("node", [scriptPath, ...args], {
    cwd,
    env,
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function change(path: string, added: string[] = [], removed: string[] = []): FileChange {
  return { path, added, removed };
}

function commit(files: FileChange[], message = "fix(x): 说明"): Commit {
  return { sha: "abcdef1234567", message, files };
}

function hitIds(c: Commit) {
  return rules.evaluateCommit(c).map((hit) => hit.rule.id);
}

describe("规则表", () => {
  it("每条规则都有 id、说明和 check 函数，id 不重复", () => {
    const ids = rules.RULES.map((rule) => rule.id);
    expect(ids).toEqual(
      expect.arrayContaining(["rule-files", "weakened-tests", "redaction-corpus", "sleep-timing"]),
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of rules.RULES) {
      expect(rule.description).not.toBe("");
      expect(typeof rule.check).toBe("function");
    }
  });
});

describe("isRuleFile", () => {
  it.each([
    ".claude/settings.json",
    ".claude/skills",
    "scripts/check-doc-layout.mjs",
    "scripts/check-commit-rules.mjs",
    "eslint.config.js",
    "eslint.config.mjs",
    "scripts/eslint-rules/x.mjs",
    "scripts/eslint-rules/index.mjs",
    "scripts/eslint-rules/no-raw-ipc-in-effect.d.mts",
    "src/components/ui/buttonSizeAudit.test.ts",
    "src/styles/radiusAudit.test.ts",
    "src/styles/tokens.baseline.json",
    "docs/agent-incidents/README.md",
    "docs/testing.md",
    "AGENTS.md",
    "CLAUDE.md",
    ".github/workflows/ci.yml",
    ".github/workflows/release.yml",
  ])("%s 是规则类文件", (path) => {
    expect(rules.isRuleFile(path)).toBe(true);
  });

  it.each([
    "docs/agent-incidents/INC-0012.yaml",
    "docs/agent-incidents/batch-1-proposals.md",
    "docs/release.md",
    "scripts/merge-claude-schema.mjs",
    "scripts/lib/claude-schema-merge.mjs",
    "scripts/eslint-rules-notes.md",
    "src/styles/global.css",
    "src/features/services/ServicesView.test.tsx",
    "src/components/ui/Button.tsx",
    "README.md",
    "docs/specs/AGENTS.md.bak",
    ".github/dependabot.yml",
  ])("%s 不是规则类文件", (path) => {
    expect(rules.isRuleFile(path)).toBe(false);
  });
});

describe("isTestFile", () => {
  it.each([
    "src/a/b.test.ts",
    "src/a/b.test.tsx",
    "e2e/smoke.spec.ts",
    "src-tauri/src/environment/zsh_tests.rs",
    "src-tauri/tests/ipc_contract.rs",
    "src-tauri/src/config/tests.rs",
    "src-tauri/src/tests.rs",
  ])("%s 是测试文件", (path) => {
    expect(rules.isTestFile(path)).toBe(true);
  });

  it.each(["src/a/b.ts", "src-tauri/src/grants/write.rs", "src-tauri/src/mytests.rs.bak"])(
    "%s 不是测试文件",
    (path) => {
      expect(rules.isTestFile(path)).toBe(false);
    },
  );
});

describe("断言与跳过标记计数", () => {
  it("TS 数 expect(，Rust 数 assert 系列宏，Rust 的 .expect( 不算断言", () => {
    expect(rules.countAssertions(["  expect(a).toBe(1);", "const b = 2;"], "a.test.ts")).toBe(1);
    expect(
      rules.countAssertions(
        ["assert!(x);", "assert_eq!(a, b);", "assert_ne!(a, c);", 'let v = f().expect("ok");'],
        "t_tests.rs",
      ),
    ).toBe(3);
  });

  it("识别 TS 的 skip/only/todo 与 Rust 的 #[ignore]，Rust 迭代器 skip 不算", () => {
    expect(rules.countSkipMarkers(["it.skip('a', f);", "describe.only('b', f);", "it.todo('c');"], "a.test.ts")).toBe(3);
    expect(rules.countSkipMarkers(["#[ignore]", '#[ignore = "slow"]'], "a_tests.rs")).toBe(2);
    expect(rules.countSkipMarkers(["let v = it.skip(1).collect();"], "a_tests.rs")).toBe(0);
  });
});

describe("weakensAssertions", () => {
  it("只新增断言不算削弱", () => {
    expect(
      rules.weakensAssertions(change("a.test.ts", ["expect(a).toBe(1);", "expect(b).toBe(2);"], [])),
    ).toBe(false);
  });

  it("TS：删掉的断言多于新增算削弱，一删一增（改文案）不算", () => {
    expect(rules.weakensAssertions(change("a.test.ts", [], ["expect(a).toBe(1);"]))).toBe(true);
    expect(
      rules.weakensAssertions(
        change("a.test.ts", ['expect(t).toContain("新");'], ['expect(t).toContain("旧");']),
      ),
    ).toBe(false);
  });

  it("Rust：既有断言被删除或改写都算，原样搬动不算", () => {
    expect(
      rules.weakensAssertions(
        change("z_tests.rs", ["assert_eq!(p, New);"], ["assert_eq!(p, Old);"]),
      ),
    ).toBe(true);
    expect(rules.weakensAssertions(change("z_tests.rs", [], ["assert!(x);"]))).toBe(true);
    expect(
      rules.weakensAssertions(change("z_tests.rs", ["    assert!(x);"], ["assert!(x);"])),
    ).toBe(false);
    expect(rules.weakensAssertions(change("z_tests.rs", ["assert!(y);"], []))).toBe(false);
  });
});

describe("parseApproval", () => {
  it("取审批行的内容", () => {
    const message =
      "feat(x): 标题\n\n正文\n\nRule-Change-Approved: 用户 2026-11-03 批准（原话：“可以”）\n";
    expect(rules.parseApproval(message)).toBe("用户 2026-11-03 批准（原话：“可以”）");
  });

  it.each([
    ["没有该行", "feat(x): 标题\n\n正文"],
    ["内容为空", "feat(x): 标题\n\nRule-Change-Approved:\n"],
    ["内容只有空白", "feat(x): 标题\n\nRule-Change-Approved:    \n"],
    ["不在行首", "feat(x): 标题\n\n- Rule-Change-Approved: 可以"],
    ["大小写不符", "feat(x): 标题\n\nrule-change-approved: 可以"],
  ])("%s 时视为未批准", (_name, message) => {
    expect(rules.parseApproval(message)).toBeNull();
  });
});

describe("evaluateCommit", () => {
  it("改规则类文件被 rule-files 拦下，列出文件", () => {
    const hits = rules.evaluateCommit(commit([change("AGENTS.md"), change("src/a.ts")]));
    expect(hits.map((hit) => [hit.rule.id, hit.files])).toEqual([["rule-files", ["AGENTS.md"]]]);
  });

  it("改 scripts/eslint-rules 下的自定义规则被 rule-files 拦下，带审批行时放行", () => {
    const files = [change("scripts/eslint-rules/x.mjs", ["export {};"], [])];
    const hits = rules.evaluateCommit(commit(files));
    expect(hits.map((hit) => [hit.rule.id, hit.files])).toEqual([
      ["rule-files", ["scripts/eslint-rules/x.mjs"]],
    ]);
    expect(
      hitIds(commit(files, "feat(lint): 说明\n\nRule-Change-Approved: 用户原话：“可以”")),
    ).toEqual([]);
  });

  it("删除规则类文件同样被拦", () => {
    expect(hitIds(commit([change("src/styles/radiusAudit.test.ts", [], ["const x = 1;"])]))).toEqual([
      "rule-files",
    ]);
  });

  it("INC yaml 与 batch 文档属于普通维护，不被拦", () => {
    expect(
      hitIds(
        commit([
          change("docs/agent-incidents/INC-0021.yaml"),
          change("docs/agent-incidents/batch-1-proposals.md"),
        ]),
      ),
    ).toEqual([]);
  });

  it("只新增断言的测试提交不被拦", () => {
    expect(
      hitIds(commit([change("src/a.test.ts", ["expect(a).toBe(1);"], [])])),
    ).toEqual([]);
  });

  it("削弱测试被 weakened-tests 拦下", () => {
    expect(hitIds(commit([change("src/a.test.ts", [], ["expect(a).toBe(1);"])]))).toEqual([
      "weakened-tests",
    ]);
    expect(hitIds(commit([change("src/a.test.ts", ["it.skip('x', f);"], [])]))).toEqual([
      "weakened-tests",
    ]);
  });

  it("两条规则可以同时命中", () => {
    expect(
      hitIds(
        commit([change("AGENTS.md"), change("src/a.test.ts", [], ["expect(a).toBe(1);"])]),
      ),
    ).toEqual(["rule-files", "weakened-tests"]);
  });

  it("有审批行的提交放行；审批行内容为空仍然拦", () => {
    const files = [change("AGENTS.md"), change("src/a.test.ts", [], ["expect(a).toBe(1);"])];
    expect(
      hitIds(commit(files, "docs(x): 标题\n\nRule-Change-Approved: 用户原话：“可以”")),
    ).toEqual([]);
    expect(hitIds(commit(files, "docs(x): 标题\n\nRule-Change-Approved:  "))).toEqual([
      "rule-files",
      "weakened-tests",
    ]);
  });
});

describe("redaction-corpus 规则", () => {
  const CORPUS = "src-tauri/tests/fixtures/redaction_corpus.json";
  const IMPLEMENTATIONS = [
    "src-tauri/src/ai_config/config_view.rs",
    "src-tauri/src/caddy/redact.rs",
    "src-tauri/src/config/redaction.rs",
    "src-tauri/src/operations/mod.rs",
    "src-tauri/src/app_config/read.rs",
    "src/components/ui/secretMask.ts",
  ];
  const hits = (c: Commit) =>
    rules.evaluateCommit(c).filter((hit) => hit.rule.id === "redaction-corpus");

  it.each(IMPLEMENTATIONS)("只改 %s 而没有改样例集时命中，并列出该文件", (path) => {
    const found = hits(commit([change(path)]));
    expect(found.map((hit) => hit.files)).toEqual([[path]]);
  });

  it("一个提交改了多个脱敏文件时全部列出", () => {
    const found = hits(commit([change(IMPLEMENTATIONS[0]), change("README.md"), change(IMPLEMENTATIONS[IMPLEMENTATIONS.length - 1])]));
    expect(found.map((hit) => hit.files)).toEqual([[IMPLEMENTATIONS[0], IMPLEMENTATIONS[IMPLEMENTATIONS.length - 1]]]);
  });

  it("同时改动了样例集时不命中", () => {
    expect(hits(commit([change(IMPLEMENTATIONS[0]), change(CORPUS)]))).toEqual([]);
    expect(hits(commit(IMPLEMENTATIONS.map((path) => change(path)).concat(change(CORPUS))))).toEqual([]);
  });

  it("只改 README 或其他无关文件时不命中", () => {
    expect(hits(commit([change("README.md")]))).toEqual([]);
    expect(hits(commit([change("src/components/ui/SecretValue.tsx"), change("src-tauri/src/caddy/session.rs")]))).toEqual([]);
  });

  it("只改脱敏模块的测试文件或只改样例集时不命中", () => {
    expect(hits(commit([change("src-tauri/src/ai_config/config_view_tests.rs", ["assert!(a);"], [])]))).toEqual([]);
    expect(hits(commit([change(CORPUS)]))).toEqual([]);
  });

  it("带审批行的提交放行", () => {
    expect(
      rules.evaluateCommit(
        commit([change(IMPLEMENTATIONS[1])], "fix(caddy): 说明\n\nRule-Change-Approved: 用户原话：“可以”"),
      ),
    ).toEqual([]);
  });
});

describe("历史提交的 --warn 试运行", () => {
  it("命中照常列出，首行标明 [试运行]，退出码 0", () => {
    const result = runScript(["--warn", "f34583b^", "f34583b"], repoRoot);
    expect(result.status).toBe(0);
    expect(result.stdout.split("\n")[0]).toContain("[试运行]");
    expect(result.stdout).toContain("f34583b rule-files ");
  });
});

describe("历史提交的正向回归（没有审批行，必须被拦）", () => {
  it.each([
    ["f34583b", "rule-files"],
    ["7842992", "weakened-tests"],
    ["757244e", "rule-files"],
  ])("%s 被 %s 拦下并以退出码 1 结束", (sha, ruleId) => {
    const result = runScript([`${sha}^`, sha], repoRoot);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`${sha} ${ruleId} `);
  });
});

describe("历史提交的误报回归：移动测试文件", () => {
  it("3d414e3 把测试文件移到 src/app 且断言没有减少，不再被 weakened-tests 命中", () => {
    const result = runScript(["--warn", "3d414e3^", "3d414e3"], repoRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("规则变更检查通过");
    expect(result.stdout).not.toContain("weakened-tests");
  });
});

describe("历史提交的正向回归：改了脱敏实现而没改样例集", () => {
  it.each(["dadc871", "cee157a"])("%s 被 redaction-corpus 命中", (sha) => {
    const result = runScript(["--warn", `${sha}^`, sha], repoRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`${sha} redaction-corpus `);
  });
});

describe("sleep-timing 规则", () => {
  const sleepHits = (c: Commit) =>
    rules.evaluateCommit(c).filter((hit) => hit.rule.id === "sleep-timing").flatMap((hit) => hit.files);

  // 带提交后文件内容与新增行号的文件，对应 loadCommit 给候选文件补的 after / addedAt。
  function sleepChange(path: string, after: string, addedLines: number[], removed: string[] = []): FileChange {
    const all = after.split("\n");
    return { path, added: addedLines.map((n) => all[n - 1]), removed, addedAt: addedLines, after: all };
  }

  const srcFile = [
    "fn poll() {",
    "    std::thread::sleep(POLL);", // 2：非测试代码
    "}",
    "",
    "#[cfg(test)]",
    "mod tests {",
    "    #[test]",
    "    fn races() {",
    "        thread::sleep(Duration::from_millis(60));", // 9：测试模块内
    "    }",
    "}",
    "",
    "fn tail() {",
    "    thread::sleep(POLL);", // 14：测试模块之后的非测试代码
    "}",
  ].join("\n");

  describe("Rust", () => {
    it.each([
      ["src-tauri/tests/process_session.rs"],
      ["src-tauri/src/caddy/session_owned_tests.rs"],
      ["src-tauri/src/config/tests.rs"],
    ])("%s 新增 thread::sleep( 与 std::thread::sleep( 都命中，列出行号", (path) => {
      const found = sleepHits(
        commit([change(path, ["    thread::sleep(d);", "let x = 1;", "    std::thread::sleep(d);"], [])]),
      );
      expect(found).toEqual([`${path}:1`, `${path}:3`]);
    });

    it("src-tauri/src 普通文件：只有 #[cfg(test)] 条目内的新增行命中", () => {
      const path = "src-tauri/src/discovery/refresh.rs";
      expect(sleepHits(commit([sleepChange(path, srcFile, [2, 9, 14])]))).toEqual([`${path}:9`]);
    });

    it("#[cfg(test)] mod tests; 只覆盖那一行，其后的非测试代码不命中", () => {
      const after = ["#[cfg(test)]", "mod tests;", "", "fn run() {", "    thread::sleep(POLL);", "}"].join("\n");
      expect(sleepHits(commit([sleepChange("src-tauri/src/x.rs", after, [5])]))).toEqual([]);
      expect(rules.cfgTestRanges(after.split("\n"))).toEqual([[1, 2]]);
    });

    it("#[cfg(test)] 标注单个函数时只覆盖该函数，叠加其他属性也算", () => {
      const after = [
        "#[cfg(test)]",
        "#[allow(dead_code)]",
        "fn helper() {",
        "    thread::sleep(d);",
        "}",
        "fn prod() {",
        "    thread::sleep(d);",
        "}",
      ].join("\n");
      expect(rules.cfgTestRanges(after.split("\n"))).toEqual([[1, 5]]);
      expect(sleepHits(commit([sleepChange("src-tauri/src/x.rs", after, [4, 7])]))).toEqual([
        "src-tauri/src/x.rs:4",
      ]);
    });

    it("非测试代码里的 sleep 不命中（有无 after 内容都一样）", () => {
      expect(
        sleepHits(commit([change("src-tauri/src/process.rs", ["        thread::sleep(POLL_INTERVAL);"], [])])),
      ).toEqual([]);
      expect(sleepHits(commit([sleepChange("src-tauri/src/process.rs", "fn a() {\n    thread::sleep(P);\n}", [2])]))).toEqual([]);
    });

    it("注释里的 thread::sleep( 和不相关的 sleep 不命中", () => {
      const lines = ["// thread::sleep(d) 会让测试依赖时钟", "let s = tokio::time::sleep(d);", "let t = sleep_for_test(d);"];
      expect(sleepHits(commit([change("src-tauri/tests/a.rs", lines, [])]))).toEqual([]);
    });

    it.each([
      ["同一行", ["    thread::sleep(d); // timing-ok: 轮询间隔，上限 5 秒"], 1],
      ["上一行", ["    // timing-ok: 验证宽限期后被杀，必须真实等待", "    thread::sleep(d);"], 2],
      ["上方连续注释块", ["    // timing-ok: 轮询间隔，", "    // 外层有 deadline 兜底", "    thread::sleep(d);"], 3],
    ])("%s 有 timing-ok 标记时不命中", (_name, lines, at) => {
      const after = lines.join("\n");
      expect(sleepHits(commit([sleepChange("src-tauri/tests/a.rs", after, [at])]))).toEqual([]);
    });

    it.each([
      ["理由为空", "    // timing-ok:\n    thread::sleep(d);", 2],
      ["标记与 sleep 之间隔了空行", "    // timing-ok: 理由\n\n    thread::sleep(d);", 3],
      ["标记在别的语句之上", "    // timing-ok: 理由\n    let a = 1;\n    thread::sleep(d);", 3],
      ["写成了别的字样", "    // timing ok: 理由\n    thread::sleep(d);", 2],
    ])("%s 时仍然命中", (_name, after, at) => {
      expect(sleepHits(commit([sleepChange("src-tauri/tests/a.rs", after, [at])]))).toEqual([
        `src-tauri/tests/a.rs:${at}`,
      ]);
    });

    it("删除 sleep 的提交不命中；原样搬动的 sleep（同一提交先删后增同一行）不命中", () => {
      const path = "src-tauri/src/discovery/refresh.rs";
      expect(sleepHits(commit([change(path, [], ["        thread::sleep(Duration::from_millis(100));"])]))).toEqual([]);
      expect(
        sleepHits(
          commit([
            change(path, ["    thread::sleep(d);"], ["        thread::sleep(d);"]),
          ]),
        ),
      ).toEqual([]);
      expect(
        sleepHits(commit([change("src-tauri/tests/a.rs", ["thread::sleep(d);", "thread::sleep(d);"], ["thread::sleep(d);"])])),
      ).toEqual(["src-tauri/tests/a.rs:2"]);
    });

    it("带审批行的提交放行", () => {
      const files = [change("src-tauri/tests/a.rs", ["thread::sleep(d);"], [])];
      expect(hitIds(commit(files))).toEqual(["sleep-timing"]);
      expect(hitIds(commit(files, "test(x): 说明\n\nRule-Change-Approved: 用户原话：“可以”"))).toEqual([]);
    });
  });

  describe("e2e", () => {
    it.each([
      ["browser.pause", "  await browser.pause(500);"],
      ["driver.pause", "  await driver.pause(1_000);"],
      ["Promise + setTimeout", "  await new Promise((resolve) => setTimeout(resolve, 300));"],
      ["timers/promises 的 setTimeout", "  await setTimeout(300);"],
    ])("e2e 新增 %s 命中", (_name, line) => {
      expect(sleepHits(commit([change("e2e/smoke.spec.ts", [line], [])]))).toEqual(["e2e/smoke.spec.ts:1"]);
    });

    it("waitUntil、设置 WebDriver 超时、注释里的 pause 不命中", () => {
      const lines = [
        "  await browser.waitUntil(async () => (await $('[data-state=ready]').isExisting()), { timeout: 5000 });",
        "  await browser.setTimeout({ implicit: 0 });",
        "  // 不要用 browser.pause(500)",
        "  const timeoutMs = 5000;",
      ];
      expect(sleepHits(commit([change("e2e/smoke.spec.ts", lines, [])]))).toEqual([]);
    });

    it("带 timing-ok 的 e2e 等待不命中；e2e 之外的文件不检查", () => {
      expect(
        sleepHits(commit([change("e2e/smoke.spec.ts", ["  await browser.pause(500); // timing-ok: 等系统动画结束，无可观察终态"], [])])),
      ).toEqual([]);
      expect(sleepHits(commit([change("src/e2e/probe.ts", ["browser.pause(1)"], [])]))).toEqual([]);
      expect(sleepHits(commit([change("src/app/AppShell.test.tsx", ["setTimeout(r, 5)"], [])]))).toEqual([]);
    });

    it("删除 browser.pause 的提交不命中", () => {
      expect(sleepHits(commit([change("e2e/smoke.spec.ts", [], ["  await browser.pause(500);"])]))).toEqual([]);
    });
  });
});

describe("历史提交的正向回归：refresh 测试里用 sleep 比快慢", () => {
  // git log -S 'thread::sleep' -- src-tauri/src/discovery/refresh.rs 列出 98e2c8b（引入）与 b30ed3f（删除其中一处）。
  // 98e2c8b 同时引入了 duplicate_refresh_requests_join_the_active_scan（536、551 行）与 module_timeout_preserves_completed_partial_results（567 行）两处 sleep。
  it("98e2c8b 被 sleep-timing 命中，并列出 refresh.rs 里三处新增 sleep 的行号", () => {
    const result = runScript(["--warn", "98e2c8b^", "98e2c8b"], repoRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("98e2c8b sleep-timing ");
    for (const line of [536, 551, 567]) {
      expect(result.stdout).toContain(`src-tauri/src/discovery/refresh.rs:${line}`);
    }
    expect(result.stderr).toContain("timing-ok");
  });

  it("b30ed3f 删掉 sleep 的修复版本不被 sleep-timing 命中", () => {
    const result = runScript(["--warn", "b30ed3f^", "b30ed3f"], repoRoot);
    expect(result.stdout).not.toContain("sleep-timing");
  });
});

describe("sleep-timing 的命令行行为（临时仓库）", () => {
  const dir = mkdtempSync(join(tmpdir(), "commit-rules-sleep-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const env = {
    ...process.env,
    HOME: dir,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(dir, "no-global-gitconfig"),
  };
  function git(...args: string[]) {
    const result = spawnSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args],
      { cwd: dir, env, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  }
  function commitFile(path: string, content: string, message: string) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
    git("add", "-f", path);
    git("commit", "-m", message);
  }
  const rangeFrom = (before: string) => runScript(["--warn", before, "HEAD"], dir, env);

  it("e2e 新增 browser.pause 命中并给出行号；改用 waitUntil、带 timing-ok、删除 pause 都不命中", () => {
    git("init", "-q", "-b", "main");
    const spec = (body: string[]) => `it("x", async () => {\n${body.join("\n")}\n});\n`;
    commitFile("e2e/smoke.spec.ts", spec(["  await $('#a').click();"]), "test(e2e): 初始");

    let before = git("rev-parse", "HEAD");
    commitFile("e2e/smoke.spec.ts", spec(["  await $('#a').click();", "  await browser.pause(500);"]), "test(e2e): 等一下");
    const hit = rangeFrom(before);
    expect(hit.stdout).toContain("sleep-timing e2e/smoke.spec.ts:3");
    expect(hit.stderr).toContain("waitUntil");

    before = git("rev-parse", "HEAD");
    commitFile("e2e/smoke.spec.ts", spec(["  await $('#a').click();"]), "test(e2e): 删掉 pause");
    expect(rangeFrom(before).stdout).not.toContain("sleep-timing");

    before = git("rev-parse", "HEAD");
    commitFile(
      "e2e/smoke.spec.ts",
      spec(["  await $('#a').click();", "  // timing-ok: 系统动画没有可观察的终态", "  await browser.pause(500);"]),
      "test(e2e): 带标记的等待",
    );
    expect(rangeFrom(before).stdout).not.toContain("sleep-timing");
  });

  it("Rust：#[cfg(test)] 模块里新增 sleep 命中并给出提交后的行号，非测试代码里的 sleep 不命中", () => {
    git("init", "-q", "-b", "main");
    const lib = (testBody: string[], tail: string[] = []) =>
      [
        "fn work() {}",
        "",
        "#[cfg(test)]",
        "mod tests {",
        ...testBody,
        "}",
        ...tail,
        "",
      ].join("\n");
    commitFile("src-tauri/src/lib_x.rs", lib(["    #[test]", "    fn a() {}"]), "test(x): 初始");

    let before = git("rev-parse", "HEAD");
    commitFile(
      "src-tauri/src/lib_x.rs",
      lib(["    #[test]", "    fn a() {", "        std::thread::sleep(D);", "    }"]),
      "test(x): 睡一会",
    );
    expect(rangeFrom(before).stdout).toContain("sleep-timing src-tauri/src/lib_x.rs:7");

    before = git("rev-parse", "HEAD");
    commitFile(
      "src-tauri/src/lib_x.rs",
      lib(["    #[test]", "    fn a() {", "    }"], ["fn poll() {", "    thread::sleep(POLL);", "}"]),
      "feat(x): 非测试代码里的轮询",
    );
    expect(rangeFrom(before).stdout).not.toContain("sleep-timing");

    before = git("rev-parse", "HEAD");
    commitFile(
      "src-tauri/src/lib_x.rs",
      lib(["    #[test]", "    fn a() {", "        // timing-ok: 轮询标记文件，上限 5 秒", "        thread::sleep(D);", "    }"], ["fn poll() {", "    thread::sleep(POLL);", "}"]),
      "test(x): 带标记的轮询",
    );
    expect(rangeFrom(before).stdout).not.toContain("sleep-timing");

    before = git("rev-parse", "HEAD");
    commitFile(
      "src-tauri/src/lib_x.rs",
      lib(["    #[test]", "    fn a() {", "    }"], ["fn poll() {", "    thread::sleep(POLL);", "}"]),
      "test(x): 删掉测试里的 sleep",
    );
    expect(rangeFrom(before).stdout).not.toContain("sleep-timing");
  });

  it("src-tauri/tests 里新增 sleep 命中，删除含 sleep 的整个文件不命中", () => {
    git("init", "-q", "-b", "main");
    commitFile("README.md", "x\n", "chore: 初始");
    let before = git("rev-parse", "HEAD");
    commitFile("src-tauri/tests/slow.rs", "#[test]\nfn t() {\n    std::thread::sleep(D);\n}\n", "test(x): 新增集成测试");
    expect(rangeFrom(before).stdout).toContain("sleep-timing src-tauri/tests/slow.rs:3");

    before = git("rev-parse", "HEAD");
    git("rm", "-q", "src-tauri/tests/slow.rs");
    git("commit", "-m", "test(x): 删除集成测试");
    expect(rangeFrom(before).stdout).not.toContain("sleep-timing");
  });
});

describe("命令行行为（临时仓库）", () => {
  const dir = mkdtempSync(join(tmpdir(), "commit-rules-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const env = {
    ...process.env,
    HOME: dir,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(dir, "no-global-gitconfig"),
  };
  function git(...args: string[]) {
    const result = spawnSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args],
      { cwd: dir, env, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  }
  function commitFile(path: string, content: string, message: string) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
    git("add", "-f", path);
    git("commit", "-m", message);
    return git("rev-parse", "HEAD");
  }

  it("无审批行被拦，有审批行放行，普通提交放行，base 不存在或全 0 时放行", () => {
    git("init", "-q", "-b", "main");
    const base = commitFile("src/a.ts", "export {};\n", "chore: 初始");
    commitFile("docs/agent-incidents/INC-0001.yaml", "id: INC-0001\n", "docs(agent-incidents): 记错题");
    const blocked = commitFile("AGENTS.md", "rules\n", "docs(agents): 改规则");
    commitFile(
      "docs/testing.md",
      "rules\n",
      "docs(testing): 改规则\n\nRule-Change-Approved: 用户原话：“可以”",
    );

    const range = runScript([base, "HEAD"], dir, env);
    expect(range.status).toBe(1);
    expect(range.stdout).toContain(`${blocked.slice(0, 7)} rule-files AGENTS.md`);
    expect(range.stdout).not.toContain("INC-0001");
    expect(range.stdout).not.toContain("docs/testing.md");

    const warned = runScript(["--warn", base, "HEAD"], dir, env);
    expect(warned.status).toBe(0);
    expect(warned.stdout.split("\n")[0]).toContain("[试运行]");
    expect(warned.stdout).toContain(`${blocked.slice(0, 7)} rule-files AGENTS.md`);
    expect(runScript([base, "HEAD", "--warn"], dir, env).status).toBe(0);
    const warnedClean = runScript(["--warn", blocked, "HEAD"], dir, env);
    expect(warnedClean.status).toBe(0);
    expect(warnedClean.stdout).toContain("[试运行]");

    expect(runScript([base, `${base}`], dir, env).status).toBe(0);
    expect(runScript([blocked, "HEAD"], dir, env).status).toBe(0);
    expect(runScript(["0".repeat(40), "HEAD"], dir, env).status).toBe(0);
    expect(runScript(["1".repeat(40), "HEAD"], dir, env).status).toBe(0);
  });

  it("git mv 测试文件：断言不减少放行；同时删掉一条断言仍命中 weakened-tests", () => {
    git("init", "-q", "-b", "main");
    const body = Array.from({ length: 6 }, (_, i) => `  expect(value${i}).toBe(${i});`);
    const content = `it("x", () => {\n${body.join("\n")}\n});\n`;
    commitFile("src/old/moveA.test.ts", content, "test(x): 初始 A");
    commitFile("src/old/moveB.test.ts", content, "test(x): 初始 B");

    const beforeA = git("rev-parse", "HEAD");
    mkdirSync(join(dir, "src/moved"), { recursive: true });
    git("mv", "src/old/moveA.test.ts", "src/moved/moveA.test.ts");
    writeFileSync(join(dir, "src/moved/moveA.test.ts"), `${content}// 新增注释\n`);
    git("add", "-A");
    git("commit", "-m", "refactor(x): 移动 A，断言不变");
    const clean = runScript([beforeA, "HEAD"], dir, env);
    expect(clean.status, clean.stdout).toBe(0);
    expect(clean.stdout).toContain("规则变更检查通过");

    const beforeB = git("rev-parse", "HEAD");
    git("mv", "src/old/moveB.test.ts", "src/moved/moveB.test.ts");
    const weakened = content.replace("  expect(value5).toBe(5);\n", "");
    writeFileSync(join(dir, "src/moved/moveB.test.ts"), weakened);
    git("add", "-A");
    git("commit", "-m", "refactor(x): 移动 B 并删掉一条断言");
    const hit = runScript([beforeB, "HEAD"], dir, env);
    expect(hit.status).toBe(1);
    expect(hit.stdout).toContain("weakened-tests src/moved/moveB.test.ts");
  });

  it("把规则类文件 git mv 走同样会命中 rule-files", () => {
    git("init", "-q", "-b", "main");
    commitFile("scripts/eslint-rules/moveme.mjs", "export const rule = 1;\nexport const other = 2;\n", "chore: 初始规则");
    const before = git("rev-parse", "HEAD");
    mkdirSync(join(dir, "scripts/elsewhere"), { recursive: true });
    git("mv", "scripts/eslint-rules/moveme.mjs", "scripts/elsewhere/moveme.mjs");
    git("commit", "-m", "chore: 移走规则文件");
    const result = runScript([before, "HEAD"], dir, env);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("rule-files scripts/eslint-rules/moveme.mjs");
  });

  it("缺少参数时给出用法并以非 0 退出，--warn 不改变这一点", () => {
    expect(runScript([], dir, env).status).toBe(2);
    expect(runScript(["--warn"], dir, env).status).toBe(2);
  });
});
