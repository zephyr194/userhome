/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = fileURLToPath(new URL("../", import.meta.url));
const scopes = ["features", "components"].map((dir) => join(srcRoot, dir));

const LEGACY_SPACE_NAMES = ["xxs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl"];
const LEGACY_SPACE = new RegExp(
  `(?:app-space-|-ui-)(?:${LEGACY_SPACE_NAMES.join("|")})(?![\\w-])`,
);
const ARBITRARY_SPACING = /(?<![\w-])(?:p[xytblre]?|m[xytblre]?|gap(?:-[xy])?|space-[xy])-\[/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const sources = scopes
  .flatMap((dir) => walk(dir))
  .filter((file) => /\.(tsx?)$/.test(file) && !/\.test\.tsx?$/.test(file));
const rel = (file: string) => relative(srcRoot, file).split(sep).join("/");
const read = (file: string) => readFileSync(file, "utf8");

describe("UIF-4b3 间距审计", () => {
  it("features 与 components 不使用任意数值的间距工具类", () => {
    const offenders = sources.filter((file) => ARBITRARY_SPACING.test(read(file))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("features 与 components 不使用旧间距令牌名", () => {
    const offenders = sources.filter((file) => LEGACY_SPACE.test(read(file))).map(rel);
    expect(offenders).toEqual([]);
  });
});
