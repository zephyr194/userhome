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
    expect(ids).toEqual(expect.arrayContaining(["rule-files", "weakened-tests"]));
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

    expect(runScript([base, `${base}`], dir, env).status).toBe(0);
    expect(runScript([blocked, "HEAD"], dir, env).status).toBe(0);
    expect(runScript(["0".repeat(40), "HEAD"], dir, env).status).toBe(0);
    expect(runScript(["1".repeat(40), "HEAD"], dir, env).status).toBe(0);
  });

  it("缺少参数时给出用法并以非 0 退出", () => {
    expect(runScript([], dir, env).status).toBe(2);
  });
});
