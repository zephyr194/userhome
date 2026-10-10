import { describe, expect, it } from "vitest";
import type { ManagedAppSummary } from "../../ipc/catalog";
import type { UnmanagedCandidate } from "../../ipc/discovery";
import {
  isManagedCoverageClass,
  matchCandidateConfigDocument,
  normalizeCandidatePath,
  normalizeCatalogVariantPath,
} from "./candidateCatalogMatch";

function candidateOf(
  overrides: Partial<UnmanagedCandidate> = {},
): UnmanagedCandidate {
  return {
    candidateId: "candidate-1",
    displayName: "git config",
    rootKind: "HOME",
    relativePath: "~/.config/git/config",
    entryType: "FILE",
    evidence: ["CATALOG_DOCUMENT"],
    formatHints: ["GIT_CONFIG"],
    sensitivityHint: "SENSITIVE",
    classificationReason: "Catalog owns this document.",
    catalogAppId: "git",
    name: "~/.config/git/config",
    kind: "FILE",
    coverageClass: "MANAGED_WRITABLE",
    ...overrides,
  };
}

function applicationOf(
  documents: ManagedAppSummary["presentation"]["configDocuments"],
): ManagedAppSummary {
  return {
    id: "git",
    displayName: "Git",
    description: "Git",
    iconKey: "git",
    priority: "PRIORITY_A",
    coverageClass: "MANAGED_WRITABLE",
    presentation: { category: "开发工具", configDocuments: documents },
    detectionEvidence: [{ kind: "HOME_PATH", value: "HOME/.gitconfig" }],
    support: {
      limitations: ["仅受管文档。"],
      exclusions: ["未声明路径不获授权。"],
      requirement: "新增路径需要审批。",
    },
    capabilities: ["DETECT", "READ_CONFIG", "WRITE_CONFIG"],
    managedDocumentCount: documents.length,
    serviceCount: 0,
  };
}

function documentOf(
  configId: string,
  root: ManagedAppSummary["presentation"]["configDocuments"][number]["pathVariants"][number]["root"],
  relativePath: string,
) {
  return {
    configId,
    purpose: `${configId} purpose`,
    pathVariants: [
      { variantId: "primary", root, relativePath, existenceRule: "FILE" as const, precedence: 0 },
    ],
    format: "GIT_CONFIG" as const,
    formatFamily: "GIT_CONFIG" as const,
    sensitivity: "SENSITIVE" as const,
    accessMode: "READ_WRITE" as const,
    editorKey: "git-editor",
    maxSizeBytes: 262_144,
  };
}

describe("normalizeCandidatePath", () => {
  it("strips the HOME root prefix into a canonical key", () => {
    expect(normalizeCandidatePath("HOME", "~/.config/git/config")).toBe(
      "HOME/.config/git/config",
    );
  });

  it("strips non-HOME root prefixes", () => {
    expect(
      normalizeCandidatePath("XDG_CONFIG_HOME", "XDG_CONFIG_HOME/tool/config.toml"),
    ).toBe("XDG_CONFIG_HOME/tool/config.toml");
  });

  it("rejects absolute, backslash, traversal, and empty-segment paths", () => {
    expect(normalizeCandidatePath("HOME", "/etc/passwd")).toBeUndefined();
    expect(normalizeCandidatePath("HOME", "~\\config")).toBeUndefined();
    expect(normalizeCandidatePath("HOME", "~/a/../b")).toBeUndefined();
    expect(normalizeCandidatePath("HOME", "~/a//b")).toBeUndefined();
    expect(normalizeCandidatePath("HOME", "~/")).toBeUndefined();
    expect(normalizeCandidatePath("HOME", "not-a-rooted-path")).toBeUndefined();
    expect(normalizeCandidatePath("HOME", "")).toBeUndefined();
  });
});

describe("normalizeCatalogVariantPath", () => {
  it("normalizes a bare catalog relative path under its root", () => {
    expect(normalizeCatalogVariantPath("HOME", ".config/git/config")).toBe(
      "HOME/.config/git/config",
    );
  });

  it("rejects unsafe catalog variants", () => {
    expect(normalizeCatalogVariantPath("HOME", "/abs")).toBeUndefined();
    expect(normalizeCatalogVariantPath("HOME", "a/../b")).toBeUndefined();
  });
});

describe("matchCandidateConfigDocument", () => {
  it("returns the unique configId when exactly one document matches", () => {
    const application = applicationOf([
      documentOf("git-config", "HOME", ".config/git/config"),
      documentOf("git-ignore", "HOME", ".config/git/ignore"),
    ]);

    expect(matchCandidateConfigDocument(candidateOf(), application)).toEqual({
      kind: "UNIQUE",
      configId: "git-config",
    });
  });

  it("matches across differing root kinds", () => {
    const candidate = candidateOf({
      rootKind: "XDG_CONFIG_HOME",
      relativePath: "XDG_CONFIG_HOME/tool/config.toml",
    });
    const application = applicationOf([
      documentOf("tool-config", "XDG_CONFIG_HOME", "tool/config.toml"),
    ]);

    expect(matchCandidateConfigDocument(candidate, application)).toEqual({
      kind: "UNIQUE",
      configId: "tool-config",
    });
  });

  it("does not guess when multiple documents match", () => {
    const application = applicationOf([
      documentOf("a", "HOME", ".config/git/config"),
      documentOf("b", "HOME", ".config/git/config"),
    ]);

    const result = matchCandidateConfigDocument(candidateOf(), application);
    expect(result.kind).toBe("AMBIGUOUS");
    if (result.kind === "AMBIGUOUS") {
      expect([...result.configIds].sort()).toEqual(["a", "b"]);
    }
  });

  it("returns NONE when no document matches", () => {
    const application = applicationOf([
      documentOf("other", "HOME", ".config/other/config"),
    ]);

    expect(matchCandidateConfigDocument(candidateOf(), application)).toEqual({
      kind: "NONE",
    });
  });

  it("never matches a candidate owned by a different catalog app", () => {
    const application = applicationOf([
      documentOf("git-config", "HOME", ".config/git/config"),
    ]);

    expect(
      matchCandidateConfigDocument(
        candidateOf({ catalogAppId: "openssh" }),
        application,
      ),
    ).toEqual({ kind: "NONE" });
  });

  it("never matches a candidate without catalog ownership", () => {
    const application = applicationOf([
      documentOf("git-config", "HOME", ".config/git/config"),
    ]);

    expect(
      matchCandidateConfigDocument(
        candidateOf({ catalogAppId: undefined }),
        application,
      ),
    ).toEqual({ kind: "NONE" });
  });

  it("never matches an unsafe candidate path", () => {
    const application = applicationOf([
      documentOf("git-config", "HOME", ".config/git/config"),
    ]);

    expect(
      matchCandidateConfigDocument(
        candidateOf({ relativePath: "~/a/../config" }),
        application,
      ),
    ).toEqual({ kind: "NONE" });
  });
});

describe("isManagedCoverageClass", () => {
  it("recognizes only the managed coverage classes", () => {
    expect(isManagedCoverageClass("MANAGED_WRITABLE")).toBe(true);
    expect(isManagedCoverageClass("MANAGED_READ_ONLY")).toBe(true);
    expect(isManagedCoverageClass("DETECTED_UNSUPPORTED")).toBe(false);
    expect(isManagedCoverageClass("EXCLUDED")).toBe(false);
  });
});
