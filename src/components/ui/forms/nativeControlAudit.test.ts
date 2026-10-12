/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FEATURES = join(process.cwd(), "src", "features");
const TAGS = ["input", "select", "textarea", "button"] as const;
const APPROVED_BASELINE = {
  files: 14,
  input: 12,
  select: 9,
  textarea: 0,
  button: 9,
  total: 30,
} as const;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")
      ? [path]
      : [];
  });
}

function countDirectNativeControls() {
  const counts = { input: 0, select: 0, textarea: 0, button: 0 };
  let files = 0;
  for (const file of sourceFiles(FEATURES)) {
    const source = readFileSync(file, "utf8");
    let fileCount = 0;
    for (const tag of TAGS) {
      const count = source.match(new RegExp(`<${tag}\\b`, "g"))?.length ?? 0;
      counts[tag] += count;
      fileCount += count;
    }
    if (fileCount > 0) files += 1;
  }
  return { files, ...counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

describe("business-level native control migration", () => {
  it("never increases the approved direct-control baseline", () => {
    const current = countDirectNativeControls();
    for (const key of Object.keys(APPROVED_BASELINE) as Array<keyof typeof APPROVED_BASELINE>) {
      expect(current[key], `${key} direct-control count`).toBeLessThanOrEqual(
        APPROVED_BASELINE[key],
      );
    }
  });
});
