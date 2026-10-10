import { mkdir } from "node:fs/promises";
import {
  GENERATED_PATH,
  RUNTIME_CATALOG_PATH,
  SUMMARY_PATH,
  acquireCorpusMaintenanceLock,
  atomicWriteJsonGroup,
  canonicalJson,
  countBy,
  loadAndValidateInputs,
  readJson,
  sha256,
  validateGenerated,
  validateSummary,
} from "./common.mjs";

const RUNTIME_CATALOG_V1_PATH = new URL(
  "../../src-tauri/src/catalog/catalog-v1.json",
  import.meta.url,
);

const DETECTION_ONLY_SUPPORT = {
  coverageClass: "DETECTED_UNSUPPORTED",
  capabilities: ["DETECT"],
  writePermissions: [],
  reason:
    "No reviewed configuration contract or write authority is included in this corpus.",
};
const DEFAULT_LICENSE_REVIEW = {
  status: "REVIEW_REQUIRED",
  notes:
    "Review upstream metadata licensing and application-specific terms before shipping enriched facts.",
};
const DEFAULT_APPROVAL = {
  status: "PENDING",
  approvedBy: null,
  approvedAt: null,
};

function sourceFactsById(manifest) {
  return new Map(manifest.sources.map((source) => [source.id, source]));
}

function mergeRawRecords(manifest, rawSources) {
  const sourceFacts = sourceFactsById(manifest);
  const applications = new Map();

  for (const rawSource of rawSources) {
    const source = sourceFacts.get(rawSource.source.id);
    for (const record of rawSource.records) {
      const existing = applications.get(record.id);
      const packageSources = [
        ...(existing?.packageSources ?? []),
        record.package,
      ].sort((left, right) => left.type.localeCompare(right.type, "en"));
      const officialSources = [
        ...new Set([
          ...(existing?.officialSources ?? []),
          source.url,
          source.repositoryUrl,
        ]),
      ].sort((left, right) => left.localeCompare(right, "en"));
      const preferRecord =
        existing === undefined || record.package.type === "cask";
      applications.set(record.id, {
        id: record.id,
        displayName: preferRecord ? record.displayName : existing.displayName,
        summary: preferRecord ? record.summary : existing.summary,
        category: preferRecord ? record.category : existing.category,
        packageSources,
        officialSources,
        support: DETECTION_ONLY_SUPPORT,
        reviewRequired: true,
        reviewNotes:
          "This normalized Homebrew fact record is detection-only until a maintainer reviews product identity, licensing, and support boundaries.",
        licenseReview: DEFAULT_LICENSE_REVIEW,
        maintainerApproval: DEFAULT_APPROVAL,
      });
    }
  }
  return applications;
}

function applyManagedOverlays(applications, overlays) {
  for (const overlay of overlays.applications) {
    const existing = applications.get(overlay.id);
    applications.set(overlay.id, {
      id: overlay.id,
      displayName: overlay.displayName,
      summary:
        existing?.summary ??
        "Managed application overlay awaiting reviewed corpus enrichment.",
      category: overlay.category,
      packageSources: existing?.packageSources ?? [],
      officialSources: overlay.officialSources,
      support: DETECTION_ONLY_SUPPORT,
      reviewRequired: overlay.reviewRequired,
      reviewNotes: overlay.reviewNotes,
      licenseReview: overlay.licenseReview,
      maintainerApproval: overlay.maintainerApproval,
    });
  }
}

function createGeneratedCatalog(manifest, overlays, rawSources) {
  const applications = mergeRawRecords(manifest, rawSources);
  applyManagedOverlays(applications, overlays);
  return {
    schemaVersion: 1,
    sourceSnapshots: manifest.sources.map((source) => ({
      id: source.id,
      url: source.url,
      repositoryUrl: source.repositoryUrl,
      owner: source.owner,
      project: source.project,
      sha256: source.sha256,
      normalizedSha256: source.normalizedSha256,
      licenseReview: source.licenseReview,
      maintainerApproval: source.maintainerApproval,
    })),
    defaults: {
      coverageClass: manifest.policy.defaultCoverageClass,
      capabilities: manifest.policy.defaultCapabilities,
      writePermissions: manifest.policy.defaultWritePermissions,
    },
    applications: [...applications.values()].sort((left, right) =>
      left.id.localeCompare(right.id, "en"),
    ),
  };
}

function createRuntimeCatalog(generated, currentCatalog, manifest) {
  if (
    currentCatalog.schemaVersion !== 1 ||
    !Array.isArray(currentCatalog.apps)
  ) {
    throw new Error("Runtime catalog v1 has an unsupported shape");
  }

  const apps = new Map(currentCatalog.apps.map((app) => [app.id, app]));
  for (const application of generated.applications) {
    const sourceEvidence = application.officialSources.map((url) => {
      const snapshot = manifest.sources.find((source) => source.url === url);
      return {
        url,
        licenseStatus: application.licenseReview.status,
        reviewStatus: application.maintainerApproval.status,
        ...(snapshot
          ? {
              contentSha256: snapshot.sha256,
              verifiedAt: snapshot.verifiedAt.replace(/\.\d{3}Z$/u, "Z"),
            }
          : {}),
      };
    });
    if (apps.has(application.id)) {
      apps.set(application.id, {
        ...apps.get(application.id),
        sourceEvidence,
      });
      continue;
    }

    const formulae = application.packageSources
      .filter((source) => source.type === "formula")
      .map((source) => source.token)
      .sort((left, right) => left.localeCompare(right, "en"));
    const casks = application.packageSources
      .filter((source) => source.type === "cask")
      .map((source) => source.token)
      .sort((left, right) => left.localeCompare(right, "en"));
    const detectionRules = [
      ...formulae.map((value) => ({ kind: "BREW_FORMULA", value })),
      ...casks.map((value) => ({ kind: "BREW_CASK", value })),
    ];
    if (detectionRules.length === 0) {
      throw new Error(
        `Detection-only application ${application.id} has no package evidence`,
      );
    }

    apps.set(application.id, {
      id: application.id,
      displayName: application.displayName,
      description: application.summary,
      supportRequirement: application.support.reason,
      iconKey: "application",
      coverageClass: "DETECTED_UNSUPPORTED",
      presentation: {
        category: application.category,
      },
      detectionRules,
      executables: [],
      brewFormulae: formulae,
      brewCasks: casks,
      configDocuments: [],
      services: [],
      capabilities: ["DETECT"],
      sourceEvidence,
    });
  }

  return {
    schemaVersion: 1,
    apps: [...apps.values()],
  };
}

function createSummary(
  generated,
  overlays,
  rawSources,
  artifactSha256,
) {
  const sourceRecords = Object.fromEntries(
    rawSources.map((source) => [source.source.id, source.records.length]),
  );
  return {
    schemaVersion: 1,
    artifact: {
      path: "generated/catalog-packaged.json",
      sha256: artifactSha256,
    },
    counts: {
      uniqueApplications: generated.applications.length,
      formulaRecords: sourceRecords["homebrew-formula-api"],
      caskRecords: sourceRecords["homebrew-cask-api"],
      managedOverlays: overlays.applications.length,
    },
    categories: countBy(
      generated.applications,
      (application) => application.category,
    ),
    supportClasses: countBy(
      generated.applications,
      (application) => application.support.coverageClass,
    ),
    sourceRecords,
    review: {
      required: generated.applications.filter(
        (application) => application.reviewRequired,
      ).length,
      missingOfficialSource: generated.applications.filter(
        (application) => application.officialSources.length === 0,
      ).length,
      maintainerApprovalPending: generated.applications.filter(
        (application) =>
          application.maintainerApproval.status === "PENDING",
      ).length,
    },
    reproducibility: {
      byteIdenticalBuild: true,
      timestampsExcludedFromArtifact: true,
    },
  };
}

async function main() {
  const releaseLock = await acquireCorpusMaintenanceLock("build");
  try {
    const { manifest, overlays, rawSources } = await loadAndValidateInputs();
    const { value: currentCatalog } = await readJson(
      RUNTIME_CATALOG_V1_PATH,
      "runtime catalog v1",
    );
    for (const source of rawSources) {
      const minimum =
        source.recordKind === "formula"
          ? manifest.policy.minimumFormulaRecords
          : manifest.policy.minimumCaskRecords;
      if (source.records.length < minimum) {
        throw new Error(
          `${source.source.id} contains ${source.records.length} records; minimum is ${minimum}`,
        );
      }
    }

    const generated = createGeneratedCatalog(manifest, overlays, rawSources);
    validateGenerated(generated, manifest);
    const runtimeCatalog = createRuntimeCatalog(
      generated,
      currentCatalog,
      manifest,
    );
    if (runtimeCatalog.apps.length !== generated.applications.length) {
      throw new Error(
        `Runtime catalog contains ${runtimeCatalog.apps.length} applications; expected ${generated.applications.length}`,
      );
    }
    const artifactText = canonicalJson(generated);
    const artifactSha256 = sha256(artifactText);
    const summary = createSummary(
      generated,
      overlays,
      rawSources,
      artifactSha256,
    );
    validateSummary(summary, generated, artifactSha256);

    await mkdir(new URL("../../catalog-corpus/generated/", import.meta.url), {
      recursive: true,
    });
    await mkdir(new URL("../../catalog-corpus/reports/", import.meta.url), {
      recursive: true,
    });
    await atomicWriteJsonGroup(
      [
        { filePath: GENERATED_PATH, value: generated },
        { filePath: SUMMARY_PATH, value: summary },
        { filePath: RUNTIME_CATALOG_PATH, value: runtimeCatalog },
      ],
      "build",
    );
    console.log(
      `Built ${generated.applications.length} unique applications (${artifactSha256}).`,
    );
  } finally {
    await releaseLock();
  }
}

main().catch((error) => {
  console.error(`Corpus build failed: ${error.message}`);
  process.exitCode = 1;
});
