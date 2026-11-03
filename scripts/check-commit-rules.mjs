// 提交级规则变更门禁（提案 P5）。
// 用法：node scripts/check-commit-rules.mjs [--warn] <base> <head>
// --warn（试运行）：照常打印命中，首行标明 [试运行]，但退出码恒为 0，不阻止合并。
// 检查 `git rev-list --no-merges <base>..<head>` 中的每个提交：
// 改了规则类文件或削弱了测试的提交，必须在提交信息里带一行 `Rule-Change-Approved: <用户原话或批准出处>`。
// 运行位置：协调者合并分支前一次，CI 对 PR 与 push 的提交范围一次。不依赖 git hook 或 Claude hook。
// 新规则（如 P1）往 RULES 追加一项即可：check(commit) 返回命中的文件路径数组，空数组表示通过。
// sleep-timing（Q1）需要新增行的行号和提交后的文件内容：loadCommit 为候选文件补 addedAt 与 after，见 isSleepScope。
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ZERO_SHA = /^0+$/;
// 改名检测的相似度阈值：默认 50% 不够，3d414e3 移动并大幅扩写的 sequenceGate.test.ts 只有 42%。
const RENAME_FLAG = '-M30%';
const APPROVAL_LINE = /^Rule-Change-Approved:[ \t]*(\S.*?)[ \t]*$/m;

// 规则类文件。INC-*.yaml、batch-*.md 属于普通维护，不在此列。
const RULE_FILE_PATTERNS = [
  /^\.claude\//,
  /^scripts\/check-[^/]*\.mjs$/,
  /(^|\/)eslint\.config\.[^/]+$/,
  /^scripts\/eslint-rules\//,
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
  'src-tauri/src/operations/mod.rs',
  'src-tauri/src/app_config/read.rs',
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

// ---- sleep-timing（提案 Q1，签名 S21）：测试用 sleep / pause 比快慢，CI 高负载下偶发失败 ----
// 范围：Rust 测试代码（*_tests.rs、tests.rs、src-tauri/tests/**，以及 src-tauri/src/**/*.rs 里 #[cfg(test)] 标注的条目）与 e2e/**。
// 只看提交新增的行；同一提交里原样删除又新增的行（搬动）互相抵消。
// 放行约定：同一行或紧挨在上方的连续注释块里写 `// timing-ok: <理由>`（理由不能为空）。
const RUST_SLEEP = /\bthread::sleep\s*\(/;
const E2E_PAUSE = /\b(?:browser|driver)\.pause\s*\(/;
// 裸 setTimeout 当作等待；`browser.setTimeout({...})` 是设置 WebDriver 超时，不是等待，前面有 `.` 的一律不算。
const E2E_SET_TIMEOUT = /(?<![.\w])setTimeout\b/;
const TIMING_OK = /(?:\/\/|\/\*)[ \t]*timing-ok:[ \t]*\S/;
const CFG_TEST_ATTR = /^\s*#\[cfg\(test\)\]\s*$/;

const isSrcRust = (path) => /^src-tauri\/.+\.rs$/.test(path);
const isE2eFile = (path) => /^e2e\/.+\.[cm]?[jt]s$/.test(path);

// 候选文件：loadCommit 只为这些文件补 addedAt / after。
export function isSleepScope(path) {
  return isSrcRust(path) || isE2eFile(path);
}

export function isSleepLine(line, path) {
  const code = line.replace(/\/\/.*$/, '');
  if (isE2eFile(path)) return E2E_PAUSE.test(code) || E2E_SET_TIMEOUT.test(code);
  return RUST_SLEEP.test(code);
}

// 返回文件里 #[cfg(test)] 标注条目所占的 1 起始行号区间 [起, 止]（含）。
// 条目到第一个以 `;` 结尾的行结束（`mod tests;`、`use ...;`），否则到与属性同缩进的 `}` 为止（rustfmt 下成立）。
export function cfgTestRanges(lines) {
  const ranges = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!CFG_TEST_ATTR.test(lines[i])) continue;
    const indent = /^\s*/.exec(lines[i])[0];
    let item = i + 1;
    while (item < lines.length && /^\s*#\[/.test(lines[item])) item += 1;
    if (item >= lines.length) break;
    let end = item;
    if (!lines[item].trimEnd().endsWith(';')) {
      end = lines.length - 1;
      for (let j = item + 1; j < lines.length; j += 1) {
        if (lines[j].startsWith(`${indent}}`)) {
          end = j;
          break;
        }
      }
    }
    ranges.push([i + 1, end + 1]);
    i = end;
  }
  return ranges;
}

// 同一行或紧挨在上方的连续 `//` / `/* */` 注释块里有 timing-ok 标记。n 为 1 起始行号。
function hasTimingOk(after, n) {
  if (TIMING_OK.test(after[n - 1] ?? '')) return true;
  for (let i = n - 2; i >= 0 && /^\s*(?:\/\/|\/\*|\*)/.test(after[i]); i -= 1) {
    if (TIMING_OK.test(after[i])) return true;
  }
  return false;
}

// file = { path, added, removed, addedAt?, after? }。没有 addedAt / after 时，把 added 当作整个文件内容（按行号 1..n）。
// 返回 `路径:行号` 数组。
export function sleepViolations(file) {
  if (!isSleepScope(file.path) || file.added.length === 0) return [];
  const real = file.after && file.addedAt;
  const after = real ? file.after : file.added;
  const addedAt = real ? file.addedAt : file.added.map((_, i) => i + 1);
  const wholeFileIsTest = isE2eFile(file.path) || isTestFile(file.path);
  const ranges = wholeFileIsTest ? [] : cfgTestRanges(after);
  const moved = new Map();
  for (const line of file.removed) moved.set(line.trim(), (moved.get(line.trim()) ?? 0) + 1);
  const hits = [];
  file.added.forEach((line, i) => {
    const n = addedAt[i];
    if (!isSleepLine(line, file.path)) return;
    const left = moved.get(line.trim()) ?? 0;
    if (left > 0) {
      moved.set(line.trim(), left - 1);
      return;
    }
    if (!wholeFileIsTest && !ranges.some(([from, to]) => n >= from && n <= to)) return;
    if (hasTimingOk(after, n)) return;
    hits.push(`${file.path}:${n}`);
  });
  return hits;
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
      '提交改动了脱敏实现文件（config_view.rs、caddy/redact.rs、config/redaction.rs、operations/mod.rs、app_config/read.rs、secretMask.ts），却没有同时改动共享样例集 src-tauri/tests/fixtures/redaction_corpus.json；脱敏改动必须新增或确认样例',
    check: (commit) => {
      const paths = commit.files.map((f) => f.path);
      if (paths.includes(REDACTION_CORPUS_FILE)) return [];
      return paths.filter((path) => REDACTION_IMPLEMENTATION_FILES.includes(path));
    },
  },
  {
    id: 'sleep-timing',
    description:
      '测试代码新增了 thread::sleep(（Rust 测试：*_tests.rs、tests.rs、src-tauri/tests/**、#[cfg(test)] 条目内），或 e2e/** 新增了 browser.pause( / 当作等待的 setTimeout；用 sleep 比快慢会在 CI 高负载下偶发失败（INC-0025）。' +
      '改用测试控制的屏障或 channel；e2e 改用 waitUntil 加明确的终态选择器。' +
      '确有必要时（如验证“超过宽限期后被杀”、轮询间隔的上限等待）在同一行或紧挨的上方注释里写 `// timing-ok: <理由>`，理由不能为空；带标记的不命中',
    check: (commit) => commit.files.flatMap(sleepViolations),
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

// 解析 `git diff-tree -p -U0 -M` 输出，按（新）路径收集新增与删除的行。
// 改名/移动的文件头是 `diff --git a/旧 b/新`，新路径取自其后的 `rename to` 行，行内容是旧内容对新内容的差异。
function parsePatch(patch) {
  const byPath = new Map();
  let current = null;
  let inHunk = false;
  let newLine = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const plain = /^diff --git a\/(.+) b\/\1$/.exec(line);
      current = { path: plain ? plain[1] : null, added: [], removed: [], addedAt: [] };
      inHunk = false;
    } else if (current && line.startsWith('@@')) {
      inHunk = true;
      newLine = Number(/^@@ -\S+ \+(\d+)/.exec(line)?.[1] ?? 0);
    } else if (current && !inHunk && line.startsWith('rename to ')) {
      current.path = line.slice('rename to '.length);
    } else if (current && inHunk) {
      if (line.startsWith('+')) {
        current.added.push(line.slice(1));
        current.addedAt.push(newLine);
        newLine += 1;
      } else if (line.startsWith('-')) current.removed.push(line.slice(1));
    }
    if (current?.path) byPath.set(current.path, current);
  }
  return byPath;
}

// 解析 `git diff-tree --name-status -z -M`：普通项 `状态\0路径\0`，改名项 `Rnn\0旧路径\0新路径\0`。
function parseNameStatus(output) {
  const tokens = output.split('\0').filter(Boolean);
  const entries = [];
  for (let i = 0; i < tokens.length; ) {
    if (tokens[i].startsWith('R')) {
      entries.push({ path: tokens[i + 2], oldPath: tokens[i + 1] });
      i += 3;
    } else {
      entries.push({ path: tokens[i + 1] });
      i += 2;
    }
  }
  return entries;
}

// 改名的文件同时列出旧路径（空内容）和新路径：移走规则类文件、脱敏实现文件照样命中。
// 内容差异挂在新路径上；只有“测试文件改名成非测试文件”时挂在旧路径上，这样断言减少仍被识别。
export function loadCommit(sha) {
  const message = git(['log', '-1', '--format=%B', sha]);
  const entries = parseNameStatus(
    git(['diff-tree', '--root', '--no-commit-id', RENAME_FLAG, '-r', '--name-status', '-z', sha]),
  );
  const patchPaths = entries
    .flatMap((entry) => [entry.path, entry.oldPath])
    .filter((path) => path && (isTestFile(path) || isSleepScope(path)));
  const patches =
    patchPaths.length > 0
      ? parsePatch(git(['diff-tree', '--root', '--no-commit-id', RENAME_FLAG, '-r', '-p', '-U0', sha, '--', ...patchPaths]))
      : new Map();
  const files = entries.flatMap(({ path, oldPath }) => {
    const empty = (p) => ({ path: p, added: [], removed: [] });
    if (!oldPath) return [patches.get(path) ?? empty(path)];
    const content = patches.get(path) ?? empty(path);
    return !isTestFile(path) && isTestFile(oldPath)
      ? [{ ...content, path: oldPath }, empty(path)]
      : [empty(oldPath), content];
  });
  for (const file of files) attachAfterContent(sha, file);
  return { sha, message, files };
}

// sleep-timing 需要提交后的文件内容来判断新增行是否在 #[cfg(test)] 条目内、旁边有没有 timing-ok；只为有候选行的文件读取。
function attachAfterContent(sha, file) {
  if (!isSleepScope(file.path) || !file.added.some((line) => isSleepLine(line, file.path))) return;
  try {
    file.after = git(['show', `${sha}:${file.path}`]).split('\n');
  } catch {
    // 文件在该提交里不存在（删除或改名的旧路径）：退回只看新增行。
  }
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
