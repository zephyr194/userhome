/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

// SPEC-theme-refine.md §4.2.1: size="sm" is reserved for notices, inline row actions,
// value-adjacent tools and IconButton/CloseButton; every other button is md (the default).
const SM_ALLOWED_FILES = [
  "src/app/AppShell.tsx",
  "src/components/ui/CopyButton.tsx",
  "src/components/ui/PasteButton.tsx",
  "src/components/ui/SecretValue.tsx",
  "src/features/ai-config/ConfigFileViewer.tsx",
  "src/features/caddy/CaddyRulesEditor.tsx",
  "src/features/dashboard/DashboardPage.tsx",
  "src/features/environment/DotenvEditor.tsx",
  "src/features/environment/LazySecretValue.tsx",
  "src/features/environment/VariableChainTable.tsx",
  "src/features/environment/ZshEditor.tsx",
  "src/features/grants/GrantStoreNotice.tsx",
  "src/features/services/CreateServiceDialog.tsx",
  "src/features/services/EditServiceDialog.tsx",
  "src/features/services/LaunchdActionPanel.tsx",
  "src/features/services/ServiceSummaryPanel.tsx",
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
