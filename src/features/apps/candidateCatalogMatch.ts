import type {
  ConfigPathRoot,
  ManagedAppCoverageClass,
  ManagedAppSummary,
  ManagedConfigDocumentPresentation,
} from "../../ipc/catalog";
import { hasControlCharacters } from "../../ipc/core";
import type { CandidateRootKind, UnmanagedCandidate } from "../../ipc/discovery";

/**
 * Root prefixes used by the safe display-path contract. Candidate
 * `relativePath` values already carry their root prefix (for example
 * `~/.config/git/config`); catalog path variants carry a bare path relative to
 * a root. Normalizing both to `<ROOT>/<segments>` lets us compare them without
 * trusting either side.
 */
const ROOT_PREFIXES: Record<CandidateRootKind, string> = {
  HOME: "~/",
  XDG_CONFIG_HOME: "XDG_CONFIG_HOME/",
  APPLICATION_SUPPORT: "APPLICATION_SUPPORT/",
  HOMEBREW_PREFIX: "HOMEBREW_PREFIX/",
  APP_SUPPORT: "APP_SUPPORT/",
};

function splitSafeSegments(path: string): string[] | undefined {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    hasControlCharacters(path)
  ) {
    return undefined;
  }
  const segments = path.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    return undefined;
  }
  return segments;
}

/**
 * Canonical key for an unmanaged candidate's root + relativePath, or
 * `undefined` when the path is not a safe root-relative path.
 */
export function normalizeCandidatePath(
  rootKind: CandidateRootKind,
  relativePath: string,
): string | undefined {
  const prefix = ROOT_PREFIXES[rootKind];
  if (prefix === undefined || typeof relativePath !== "string") {
    return undefined;
  }
  if (!relativePath.startsWith(prefix)) {
    return undefined;
  }
  const segments = splitSafeSegments(relativePath.slice(prefix.length));
  if (!segments) {
    return undefined;
  }
  return `${rootKind}/${segments.join("/")}`;
}

/**
 * Canonical key for a catalog path variant. The variant path is bare (no root
 * prefix), so it only needs the shared safety normalization.
 */
export function normalizeCatalogVariantPath(
  root: ConfigPathRoot,
  relativePath: string,
): string | undefined {
  if (typeof relativePath !== "string") {
    return undefined;
  }
  const segments = splitSafeSegments(relativePath);
  if (!segments) {
    return undefined;
  }
  return `${root}/${segments.join("/")}`;
}

export type CandidateConfigMatch =
  | { kind: "UNIQUE"; configId: string }
  | { kind: "AMBIGUOUS"; configIds: readonly string[] }
  | { kind: "NONE" };

export function isManagedCoverageClass(
  coverageClass: ManagedAppCoverageClass,
): boolean {
  return (
    coverageClass === "MANAGED_WRITABLE" ||
    coverageClass === "MANAGED_READ_ONLY"
  );
}

/**
 * Matches a candidate to a single managed config document by comparing the
 * candidate's safe root-relative path with the catalog's declared path
 * variants. A match is only reported when the candidate is owned by the given
 * catalog application and exactly one document matches; zero or multiple
 * matches never guess a configId.
 */
export function matchCandidateConfigDocument(
  candidate: Pick<
    UnmanagedCandidate,
    "rootKind" | "relativePath" | "catalogAppId"
  >,
  application: Pick<ManagedAppSummary, "id" | "presentation">,
): CandidateConfigMatch {
  if (
    candidate.catalogAppId === undefined ||
    candidate.catalogAppId !== application.id
  ) {
    return { kind: "NONE" };
  }
  const candidateKey = normalizeCandidatePath(
    candidate.rootKind,
    candidate.relativePath,
  );
  if (candidateKey === undefined) {
    return { kind: "NONE" };
  }
  const matched = new Set<string>();
  for (const document of application.presentation.configDocuments) {
    if (
      documentMatchesKey(document, candidateKey)
    ) {
      matched.add(document.configId);
    }
  }
  const configIds = [...matched];
  if (configIds.length === 1) {
    return { kind: "UNIQUE", configId: configIds[0] };
  }
  if (configIds.length > 1) {
    return { kind: "AMBIGUOUS", configIds };
  }
  return { kind: "NONE" };
}

function documentMatchesKey(
  document: ManagedConfigDocumentPresentation,
  candidateKey: string,
): boolean {
  return document.pathVariants.some(
    (variant) =>
      normalizeCatalogVariantPath(variant.root, variant.relativePath) ===
      candidateKey,
  );
}
