/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const VARIANTS = new Set(["primary", "secondary", "ghost", "danger"]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".tsx") && !entry.name.includes(".test.") ? [path] : [];
  });
}

/** Every <Button> must state its tier; the implicit default hides the primary/secondary/ghost hierarchy. */
function buttonsWithoutVariant(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText() === "Button"
    ) {
      const variant = node.attributes.properties.find(
        (attribute): attribute is ts.JsxAttribute =>
          ts.isJsxAttribute(attribute) && attribute.name.getText() === "variant",
      );
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      if (!variant) found.push(`${file.slice(SRC.length + 1)}:${line}`);
      else if (variant.initializer && ts.isStringLiteral(variant.initializer)) {
        if (!VARIANTS.has(variant.initializer.text)) found.push(`${file}:${line} unknown variant`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("button variant audit", () => {
  it("every Button states variant explicitly", () => {
    const missing = sourceFiles(SRC).flatMap(buttonsWithoutVariant);
    expect(missing).toEqual([]);
  });
});
