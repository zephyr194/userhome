import { readdirSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const skipNames = new Set(['node_modules', 'dist', '.git', '.agents', '.claude']);
const skipPaths = new Set(['src-tauri/target', 'src-tauri/gen', 'src-tauri/helper']);
const specFile = /^(SPEC|spec)([-_].*)?\.md$/i;
const capabilityMap = 'CAPABILITY-MAP.md';
const specDir = 'docs/specs/';

function walk(dir, files) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    const rel = relative(root, abs).split(sep).join('/');
    if (entry.isDirectory()) {
      if (!skipNames.has(entry.name) && !skipPaths.has(rel)) walk(abs, files);
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
  return files;
}

const misplaced = walk(root, []).filter((rel) => {
  const name = basename(rel);
  return (specFile.test(name) || name === capabilityMap) && !rel.startsWith(specDir);
});

for (const rel of misplaced) console.error(`规格文件必须放在 docs/specs/ 下：${rel}`);
if (misplaced.length > 0) process.exit(1);
