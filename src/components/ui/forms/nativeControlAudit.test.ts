/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const FORMS = join(SRC, "components", "ui", "forms");
const FORM_TAGS = ["input", "select", "textarea", "option"] as const;
const BUTTON_TAGS = ["button"] as const;
const APPROVED_BASELINE = {
  files: 0,
  input: 0,
  select: 0,
  textarea: 0,
  option: 0,
  button: 0,
  total: 0,
} as const;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return path === FORMS ? [] : sourceFiles(path);
    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")
      ? [path]
      : [];
  });
}

function countDirectNativeControls<Tag extends string>(
  directory: string,
  tags: readonly Tag[],
) {
  const counts = Object.fromEntries(tags.map((tag) => [tag, 0])) as Record<Tag, number>;
  let files = 0;
  for (const file of sourceFiles(directory)) {
    const source = readFileSync(file, "utf8");
    let fileCount = 0;
    for (const tag of tags) {
      const count = source.match(new RegExp(`<${tag}\\b`, "g"))?.length ?? 0;
      counts[tag] += count;
      fileCount += count;
    }
    if (fileCount > 0) files += 1;
  }
  const total = tags.reduce((sum, tag) => sum + counts[tag], 0);
  return { files, counts, total };
}

describe("business-level native control migration", () => {
  it("never increases the approved direct-control baseline", () => {
    const forms = countDirectNativeControls(SRC, FORM_TAGS);
    const buttons = countDirectNativeControls(SRC, BUTTON_TAGS);
    const current = {
      files: forms.files + buttons.files,
      ...forms.counts,
      ...buttons.counts,
      total: forms.total + buttons.total,
    };
    for (const key of Object.keys(APPROVED_BASELINE) as Array<keyof typeof APPROVED_BASELINE>) {
      expect(current[key], `${key} direct-control count`).toBeLessThanOrEqual(
        APPROVED_BASELINE[key],
      );
    }
  });

  it("keeps the forms module free of native select and option", () => {
    const source = readFileSync(join(FORMS, "index.tsx"), "utf8");
    expect(source).not.toMatch(/<select\b/);
    expect(source).not.toMatch(/<option\b/);
  });
});
