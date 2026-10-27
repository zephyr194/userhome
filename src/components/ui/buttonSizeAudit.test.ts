/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

// SPEC-theme-refine.md §4.2.1: size="sm" 只允许两类容器内出现：错误容器内的补救按钮
// （AsyncState kind="error" 的 action、role="alert" 的出错提示框）与右上角通知条（ShellNotice、
// GrantStoreNotice）；其余按钮一律 md（默认值，不写 size）。
const SM_ALLOWED_FILES = [
  "src/app/AppShell.tsx",
  "src/features/ai-config/AiConfigView.tsx",
  "src/features/ai-config/CommandBuilder.tsx",
  "src/features/ai-config/ConfigFileViewer.tsx",
  "src/features/ai-config/ToolReference.tsx",
  "src/features/ai-config/ToolSettings.tsx",
  "src/features/app-config/AppConfigEditor.tsx",
  "src/features/app-config/AppConfigView.tsx",
  "src/features/app-config/SupportedConfigsDialog.tsx",
  "src/features/environment/EnvironmentView.tsx",
  "src/features/environment/LaunchctlView.tsx",
  "src/features/environment/ZshView.tsx",
  "src/features/grants/GrantStoreNotice.tsx",
  "src/features/services/ServicesView.tsx",
].sort();

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return path === join(SRC, "e2e") ? [] : sourceFiles(path);
    return entry.name.endsWith(".tsx") && !entry.name.includes(".test.") ? [path] : [];
  });
}

describe("button size audit", () => {
  it('limits size="sm" to the whitelisted files', () => {
    const smFiles = sourceFiles(SRC)
      .filter((file) => readFileSync(file, "utf8").includes('size="sm"'))
      .map((file) => relative(ROOT, file))
      .sort();

    expect(smFiles).toEqual(SM_ALLOWED_FILES);
  });
});
