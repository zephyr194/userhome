// 提交级规则变更门禁（提案 P5）。
// 用法：node scripts/check-commit-rules.mjs [--warn] <base> <head>
// --warn（试运行）：照常打印命中，首行标明 [试运行]，但退出码恒为 0，不阻止合并。
// 检查 `git rev-list --no-merges <base>..<head>` 中的每个提交：
// 改了规则类文件或削弱了测试的提交，必须在提交信息里带一行 `Rule-Change-Approved: <用户原话或批准出处>`。
// 运行位置：协调者合并分支前一次，CI 对 PR 与 push 的提交范围一次。不依赖 git hook 或 Claude hook。
// 新规则（如 P1）往 RULES 追加一项即可：check(commit) 返回命中的文件路径数组，空数组表示通过。
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ZERO_SHA = /^0+$/;
const APPROVAL_LINE = /^Rule-Change-Approved:[ \t]*(\S.*?)[ \t]*$/m;

// 规则类文件。INC-*.yaml、batch-*.md 属于普通维护，不在此列。
const RULE_FILE_PATTERNS = [
  /^\.claude\//,
  /^scripts\/check-[^/]*\.mjs$/,
  /(^|\/)eslint\.config\.[^/]+$/,
  /(^|\/)[^/]*Audit\.test\.[^/]+$/,
  /^src\/styles\/tokens\.baseline\.json$/,
  /^docs\/agent-incidents\/README\.md$/,
  /^docs\/testing\.md$/,
  /^AGENTS\.md$/,
  /^CLAUDE\.md$/,
  /^\.github\/workflows\//,
];

// 脱敏实现（提案 P1，签名 S11）：改动其中任何一个，都要同时改动共享样例集。
const REDACTION_IMPLEMENTATION_FILES = [
  'src-tauri/src/ai_config/config_view.rs',
  'src-tauri/src/caddy/redact.rs',
  'src-tauri/src/config/redaction.rs',
  'src/components/ui/secretMask.ts',
];
const REDACTION_CORPUS_FILE = 'src-tauri/tests/fixtures/redaction_corpus.json';

const TEST_FILE_PATTERNS = [
  /\.test\.tsx?$/,
  /\.spec\.ts$/,
  /_tests\.rs$/,
  /^src-tauri\/tests\//,
  /^src-tauri\/(?:.*\/)?tests\.rs$/,
];

// 断言与跳过标记按语言区分：Rust 的 `.expect(` / 迭代器 `.skip(` 是普通代码，不是断言或跳过用例。
const RUST_ASSERTION = /\bassert(?:_eq|_ne)?!/;
const TS_ASSERTION = /\bexpect\(/;
const RUST_SKIP_MARKER = /#\[ignore\b/;
const TS_SKIP_MARKER = /\.(?:skip|only)\(|\b(?:it|test|describe)\.todo\(/;

export function isRuleFile(path) {
  return RULE_FILE_PATTERNS.some((re) => re.test(path));
}

export function isTestFile(path) {
  return TEST_FILE_PATTERNS.some((re) => re.test(path));
}

const isRust = (path) => path.endsWith('.rs');

export function countAssertions(lines, path) {
  const re = isRust(path) ? RUST_ASSERTION : TS_ASSERTION;
  return lines.filter((line) => re.test(line)).length;
}

export function countSkipMarkers(lines, path) {
  const re = isRust(path) ? RUST_SKIP_MARKER : TS_SKIP_MARKER;
  return lines.filter((line) => re.test(line)).length;
}

// 被删除的断言行里，在新增行中找不到相同内容（忽略首尾空白）的数量；相同内容按个数一一抵消。
export function countUnmatchedRemovedAssertions(file) {
  const remaining = new Map();
  for (const line of file.added) {
    const key = line.trim();
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  const re = isRust(file.path) ? RUST_ASSERTION : TS_ASSERTION;
  let unmatched = 0;
  for (const line of file.removed) {
    if (!re.test(line)) continue;
    const key = line.trim();
    const left = remaining.get(key) ?? 0;
    if (left > 0) remaining.set(key, left - 1);
    else unmatched += 1;
  }
  return unmatched;
}

// file = { path, added, removed }。
// Rust：任何既有断言被删除或改写都算（行为契约测试，改动少，P5 要求显式批准）。
// 其他：只看净减少，因为界面文案变化会让大量 expect 行被正常改写。
export function weakensAssertions(file) {
  if (isRust(file.path)) return countUnmatchedRemovedAssertions(file) > 0;
  return countAssertions(file.removed, file.path) > countAssertions(file.added, file.path);
}

// 返回审批内容；没有该行或内容为空时返回 null。
export function parseApproval(message) {
  const match = APPROVAL_LINE.exec(message);
  return match ? match[1] : null;
}

// commit = { sha, message, files: [{ path, added: string[], removed: string[] }] }
// added / removed 只需要对测试文件填充，其余文件可以是空数组。
export const RULES = [
  {
    id: 'rule-files',
    description: '提交改动了规则类文件（新增、修改、删除都算）',
    check: (commit) => commit.files.map((f) => f.path).filter(isRuleFile),
  },
  {
    id: 'weakened-tests',
    description:
      '测试文件中删掉的断言多于新增（Rust 测试：既有断言被删除或改写），或新增了 skip/only/todo/ignore',
    check: (commit) =>
      commit.files
        .filter((f) => isTestFile(f.path))
        .filter((f) => weakensAssertions(f) || countSkipMarkers(f.added, f.path) > 0)
        .map((f) => f.path),
  },
  {
    id: 'redaction-corpus',
    description:
      '提交改动了脱敏实现文件（config_view.rs、caddy/redact.rs、config/redaction.rs、secretMask.ts），却没有同时改动共享样例集 src-tauri/tests/fixtures/redaction_corpus.json；脱敏改动必须新增或确认样例',
    check: (commit) => {
      const paths = commit.files.map((f) => f.path);
      if (paths.includes(REDACTION_CORPUS_FILE)) return [];
      return paths.filter((path) => REDACTION_IMPLEMENTATION_FILES.includes(path));
    },
  },
];

// 返回 [{ rule, files }]；带有效审批行的提交返回空数组。
export function evaluateCommit(commit, rules = RULES) {
  if (parseApproval(commit.message) !== null) return [];
  return rules
    .map((rule) => ({ rule, files: rule.check(commit) }))
    .filter((hit) => hit.files.length > 0);
}

function git(args) {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 512,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function revExists(rev) {
  try {
    git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

// 解析 `git diff-tree -p -U0` 输出，按文件收集新增与删除的行。
function parsePatch(patch) {
  const byPath = new Map();
  let current = null;
  let inHunk = false;
  for (const line of patch.split('\n')) {
    const header = /^diff --git a\/(.+) b\/\1$/.exec(line);
    if (header) {
      current = { path: header[1], added: [], removed: [] };
      byPath.set(current.path, current);
      inHunk = false;
    } else if (current && line.startsWith('@@')) {
      inHunk = true;
    } else if (current && inHunk) {
      if (line.startsWith('+')) current.added.push(line.slice(1));
      else if (line.startsWith('-')) current.removed.push(line.slice(1));
    }
  }
  return byPath;
}

export function loadCommit(sha) {
  const message = git(['log', '-1', '--format=%B', sha]);
  const paths = git(['diff-tree', '--root', '--no-commit-id', '--no-renames', '-r', '--name-only', '-z', sha])
    .split('\0')
    .filter(Boolean);
  const testPaths = paths.filter(isTestFile);
  const patches =
    testPaths.length > 0
      ? parsePatch(git(['diff-tree', '--root', '--no-commit-id', '--no-renames', '-r', '-p', '-U0', sha, '--', ...testPaths]))
      : new Map();
  const files = paths.map((path) => patches.get(path) ?? { path, added: [], removed: [] });
  return { sha, message, files };
}

export function listCommits(base, head) {
  return git(['rev-list', '--no-merges', `${base}..${head}`]).split('\n').filter(Boolean);
}

export function checkRange(base, head, rules = RULES) {
  return listCommits(base, head).flatMap((sha) =>
    evaluateCommit(loadCommit(sha), rules).map((hit) => ({ sha, ...hit })),
  );
}

function main(argv) {
  const warn = argv.includes('--warn');
  const [base, head] = argv.filter((arg) => arg !== '--warn');
  if (!base || !head) {
    console.error('用法：node scripts/check-commit-rules.mjs [--warn] <base> <head>');
    return 2;
  }
  const tag = warn ? '[试运行] ' : '';
  if (ZERO_SHA.test(base) || !revExists(base)) {
    console.log(`${tag}base ${base} 为全 0 SHA 或在本仓库中不存在，没有可比较的范围，跳过规则变更检查。`);
    return 0;
  }
  if (!revExists(head)) {
    console.error(`head ${head} 在本仓库中不存在。`);
    return 2;
  }

  const total = listCommits(base, head).length;
  const hits = checkRange(base, head);
  if (hits.length === 0) {
    console.log(`${tag}规则变更检查通过：${base}..${head} 共 ${total} 个非合并提交，无未批准的规则变更。`);
    return 0;
  }

  if (warn) console.log('[试运行] 以下提交命中规则变更门禁，仅告警，不阻止合并：');
  for (const hit of hits) {
    console.log(`${hit.sha.slice(0, 7)} ${hit.rule.id} ${hit.files.join(' ')}`);
  }
  const used = new Map(hits.map((hit) => [hit.rule.id, hit.rule.description]));
  console.error('');
  for (const [id, description] of used) console.error(`${id}：${description}`);
  const blocked = new Set(hits.map((h) => h.sha)).size;
  const approval = '`Rule-Change-Approved: <用户原话或批准出处>`';
  if (warn) {
    console.error(
      `[试运行] 共 ${blocked}/${total} 个提交命中，不阻止合并；提交仍应尽量带 ${approval} 行，协调者合并时在汇报里逐条列出命中。`,
    );
    return 0;
  }
  console.error(
    `共 ${blocked}/${total} 个提交被拦。这些提交需要在提交信息里加一行 ${approval}；协调者核对出处属实后才可放行。`,
  );
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
