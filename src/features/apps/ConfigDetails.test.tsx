import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ManagedConfigDocumentPresentation } from "../../ipc/catalog";
import type {
  ConfigDocument,
  ConfigVariantResolution,
} from "../../ipc/config";
import { ConfigDetails } from "./ConfigDetails";
import { ConfigDiagnosticDetails } from "./ConfigDiagnosticDetails";
import { resolveConfigDocumentActionMode } from "./configPresentation";
import { ConfigAdapterEditor } from "./editors/ConfigAdapterEditor";

const presentation: ManagedConfigDocumentPresentation = {
  configId: "git-global-config",
  purpose: "Git global configuration",
  pathVariants: [
    {
      variantId: "primary",
      root: "HOME",
      relativePath: ".gitconfig",
      existenceRule: "FILE",
      precedence: 0,
    },
    {
      variantId: "xdg",
      root: "XDG_CONFIG_HOME",
      relativePath: "git/config",
      existenceRule: "FILE",
      precedence: 1,
    },
  ],
  format: "GIT_CONFIG",
  formatFamily: "GIT_CONFIG",
  sensitivity: "SENSITIVE",
  accessMode: "READ_WRITE",
  editorKey: "git-config",
  maxSizeBytes: 524_288,
};

const summary = {
  appId: "git",
  configId: "git-global-config",
  variantId: "primary",
  displayPath: "~/.gitconfig",
  state: "REDACTED",
  retryable: false,
  nextAction: "VIEW_REDACTED",
  format: "GIT_CONFIG",
  sensitivity: "SENSITIVE",
  writePolicy: "STRUCTURED_AND_RAW",
  exists: true,
  entryKind: "FILE",
  sizeBytes: 24,
  mode: 0o640,
  contentHash: "a".repeat(64),
  symlink: { targetDisplayPath: "~/dotfiles/gitconfig" },
} as const;

const document: ConfigDocument = {
  ...summary,
  content: "[user]\nname = Example\n[REDACTED]",
  contentRedacted: true,
};

const variants: readonly ConfigVariantResolution[] = [
  { ...summary, selected: true },
  {
    ...summary,
    variantId: "xdg",
    displayPath: "XDG_CONFIG_HOME/git/config",
    state: "MISSING",
    nextAction: "CREATE_FILE",
    exists: false,
    entryKind: undefined,
    sizeBytes: undefined,
    mode: undefined,
    contentHash: undefined,
    symlink: undefined,
    selected: false,
  },
];

describe("ConfigDetails", () => {
  it.each([
    ["WRITE", "READ_WRITE", true, true, true, "STRUCTURED_AND_RAW"],
    ["READ_ONLY", "READ_ONLY", true, true, true, "READ_ONLY"],
    ["METADATA_ONLY", "METADATA_ONLY", true, true, true, "READ_ONLY"],
    ["EXCLUDED", "EXCLUDED", true, true, true, "READ_ONLY"],
    [
      "FORMAT_MISMATCH",
      "READ_WRITE",
      true,
      true,
      true,
      "STRUCTURED_AND_RAW",
    ],
    [
      "APPLICATION_READ_ONLY",
      "READ_WRITE",
      false,
      true,
      true,
      "STRUCTURED_AND_RAW",
    ],
    [
      "UNKNOWN_EDITOR",
      "READ_WRITE",
      true,
      false,
      true,
      "STRUCTURED_AND_RAW",
    ],
    [
      "ALTERNATE_VARIANT",
      "READ_WRITE",
      true,
      true,
      false,
      "STRUCTURED_AND_RAW",
    ],
    [
      "VARIANT_UNAVAILABLE",
      "READ_WRITE",
      true,
      true,
      undefined,
      "STRUCTURED_AND_RAW",
    ],
    [
      "MISSING_HASH",
      "READ_WRITE",
      true,
      true,
      true,
      "STRUCTURED_AND_RAW",
    ],
  ] as const)(
    "resolves %s action mode without application-specific branches",
    (
      expected,
      accessMode,
      applicationCanWrite,
      editorAvailable,
      selectedVariant,
      writePolicy,
    ) => {
      expect(
        resolveConfigDocumentActionMode({
          accessMode,
          applicationCanWrite,
          contentHash: expected === "MISSING_HASH" ? undefined : "hash",
          editorAvailable,
          formatMatches: expected !== "FORMAT_MISMATCH",
          selectedVariant,
          writePolicy,
        }),
      ).toBe(expected);
    },
  );

  it("renders bounded metadata, variants, and redacted content without exposing a real path", () => {
    const markup = renderToStaticMarkup(
      <ConfigDetails
        document={document}
        presentation={presentation}
        variants={variants}
        onVariantChange={() => undefined}
      />,
    );

    expect(markup).toContain("Git global configuration");
    expect(markup).toContain("~/.gitconfig");
    expect(markup).toContain("XDG_CONFIG_HOME/git/config");
    expect(markup).toContain("当前优先");
    expect(markup).toContain("GIT_CONFIG");
    expect(markup).toContain("[REDACTED]");
    expect(markup).toContain("max-h-80");
    expect(markup).not.toContain("/Users/");
    expect(markup).not.toContain("password");
  });

  it("hides content for metadata-only capability even if content is present", () => {
    const markup = renderToStaticMarkup(
      <ConfigDetails
        document={{ ...document, content: "must-not-render" }}
        presentation={{ ...presentation, accessMode: "METADATA_ONLY" }}
        showContent={false}
        variants={[]}
        onVariantChange={() => undefined}
      />,
    );

    expect(markup).toContain("仅允许元数据");
    expect(markup).not.toContain("must-not-render");
    expect(markup).not.toContain("<pre");
  });

  it("renders a bounded read-only viewer without editing controls", () => {
    const markup = renderToStaticMarkup(
      <ConfigDetails
        document={{
          ...document,
          writePolicy: "READ_ONLY",
          contentHash: undefined,
        }}
        presentation={{ ...presentation, accessMode: "READ_ONLY" }}
        variants={variants}
        onVariantChange={() => undefined}
      />,
    );

    expect(markup).toContain("只读");
    expect(markup).toContain("当前内容");
    expect(markup).toContain("max-h-80");
    expect(markup).not.toContain("<textarea");
  });

  it("renders a typed diagnostic with only its safe next action", () => {
    const markup = renderToStaticMarkup(
      <ConfigDiagnosticDetails
        diagnostic={{
          appId: "git",
          configId: "git-global-config",
          variantId: "primary",
          displayPath: "~/.gitconfig",
          state: "INVALID",
          retryable: false,
          nextAction: "FIX_CONTENT",
        }}
        presentation={presentation}
        variants={variants}
        onRetry={() => undefined}
        onVariantChange={() => undefined}
      />,
    );

    expect(markup).toContain("内容无效");
    expect(markup).toContain("使用对应应用修复配置内容");
    expect(markup).not.toContain("重新读取");
    expect(markup).not.toContain("<textarea");
  });

  it("does not fall back to a generic editor for an unknown editor key", () => {
    const markup = renderToStaticMarkup(
      <ConfigAdapterEditor
        document={document}
        editorKey="unknown-editor"
        onPreview={() => undefined}
      />,
    );

    expect(markup).toContain("编辑器能力不可用");
    expect(markup).toContain("保持不可操作");
    expect(markup).not.toContain("<textarea");
  });

  it("renders unsupported formats as a non-actionable diagnostic", () => {
    const markup = renderToStaticMarkup(
      <ConfigDiagnosticDetails
        diagnostic={{
          appId: "git",
          configId: "git-global-config",
          variantId: "primary",
          displayPath: "~/.gitconfig",
          state: "UNSUPPORTED_FORMAT",
          retryable: false,
          nextAction: "UPDATE_CATALOG",
        }}
        presentation={presentation}
        variants={variants}
        onRetry={() => undefined}
        onVariantChange={() => undefined}
      />,
    );

    expect(markup).toContain("格式不支持");
    expect(markup).toContain("等待或更新 catalog 能力定义");
    expect(markup).not.toContain("重新读取");
    expect(markup).not.toContain("<textarea");
  });
});
