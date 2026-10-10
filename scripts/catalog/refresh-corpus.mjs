import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  CORPUS_DIR,
  MANIFEST_PATH,
  OVERLAYS_PATH,
  canonicalJson,
  acquireCorpusMaintenanceLock,
  expectAppId,
  expectArray,
  expectBoolean,
  expectObject,
  expectPackageToken,
  expectString,
  readJson,
  resolveCorpusPath,
  sha256,
  validateManifest,
  validateNormalizedSource,
  validateOverlays,
} from "./common.mjs";

const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;
const MAX_UPSTREAM_RECORDS = 20_000;
const REQUEST_TIMEOUT_MILLISECONDS = 60_000;
const USER_AGENT = "userhome-corpus-refresh/1";
const DETECTION_ONLY_SUPPORT = {
  coverageClass: "DETECTED_UNSUPPORTED",
  capabilities: ["DETECT"],
  writePermissions: [],
  reason:
    "Homebrew metadata supports package detection only; no configuration schema or write authority has been reviewed.",
};

function categoryFor(token, displayName, summary) {
  const text = `${token} ${displayName} ${summary}`.toLowerCase();
  const categories = [
    ["Fonts", /\bfont\b|typeface|fonts?/u],
    ["Games", /\bgame\b|gaming|emulator|chess|strategy|arcade/u],
    ["AI Development Tools", /\bai\b|llm|machine learning|neural|copilot/u],
    ["Editors", /\beditor\b|ide\b|text editing|code editing/u],
    ["Terminals", /\bterminal\b|shell\b|console|command[- ]line/u],
    ["Databases", /database|sql\b|postgres|mysql|redis|mongo|sqlite/u],
    ["Networking", /network|proxy|dns\b|http\b|server|vpn\b|ssh\b/u],
    ["Security", /security|password|encryption|crypto|firewall|authentication/u],
    ["Media", /audio|video|media|music|image|photo|graphics/u],
    ["Productivity", /productivity|calendar|notes?|task|office|document/u],
    [
      "Developer Tools",
      /developer|compiler|debug|build tool|version control|git\b|sdk\b|api\b/u,
    ],
  ];
  return categories.find(([, pattern]) => pattern.test(text))?.[0] ?? "Utilities";
}

function optionalString(value, label, maxLength) {
  if (value === null || value === undefined) {
    return null;
  }
  return expectString(value, label, { maxLength });
}

function appIdForPackageToken(token) {
  const appId = token
    .replaceAll("@", "-at-")
    .replaceAll("+", "-plus-")
    .replace(/[._]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");
  return expectAppId(appId, `normalized application id for ${token}`);
}

function parseFormulaRecords(value, source) {
  const upstream = expectArray(value, "Homebrew formula API response");
  if (upstream.length > MAX_UPSTREAM_RECORDS) {
    throw new Error("Homebrew formula API response exceeds the record limit");
  }
  const records = [];
  for (const [index, candidate] of upstream.entries()) {
    const label = `Homebrew formula API response[${index}]`;
    const formula = expectObject(candidate, label);
    const token = expectPackageToken(formula.name, `${label}.name`);
    const tap = expectString(formula.tap, `${label}.tap`, { maxLength: 100 });
    const disabled = expectBoolean(formula.disabled, `${label}.disabled`);
    const deprecated = expectBoolean(formula.deprecated, `${label}.deprecated`);
    const versions = expectObject(formula.versions, `${label}.versions`);
    const stableVersion = optionalString(
      versions.stable,
      `${label}.versions.stable`,
      200,
    );
    const summary = optionalString(formula.desc, `${label}.desc`, 1000);
    const license = optionalString(formula.license, `${label}.license`, 4096);
    if (
      tap !== "homebrew/core" ||
      disabled ||
      deprecated ||
      stableVersion === null ||
      summary === null
    ) {
      continue;
    }
    records.push({
      id: appIdForPackageToken(token),
      displayName: token,
      summary,
      category: categoryFor(token, token, summary),
      package: {
        type: "formula",
        token,
        stableVersion,
        license,
      },
      support: DETECTION_ONLY_SUPPORT,
    });
  }
  records.sort((left, right) => left.id.localeCompare(right.id, "en"));
  if (records.length < source.recordLimit) {
    throw new Error(
      `Homebrew formula API produced only ${records.length} eligible records`,
    );
  }
  return records.slice(0, source.recordLimit);
}

function caskHasApplicationArtifact(value, label) {
  const artifacts = expectArray(value, label);
  if (artifacts.length > 100) {
    throw new Error(`${label} exceeds the artifact limit`);
  }
  let hasApplication = false;
  for (const [index, candidate] of artifacts.entries()) {
    const artifact = expectObject(candidate, `${label}[${index}]`);
    if (!Object.hasOwn(artifact, "app")) {
      continue;
    }
    const applications = expectArray(
      artifact.app,
      `${label}[${index}].app`,
    );
    if (applications.length > 20) {
      throw new Error(`${label}[${index}].app exceeds the entry limit`);
    }
    for (const [appIndex, application] of applications.entries()) {
      const appLabel = `${label}[${index}].app[${appIndex}]`;
      if (typeof application === "string") {
        expectString(application, appLabel, { maxLength: 500 });
        continue;
      }
      const options = expectObject(application, appLabel);
      expectString(options.target, `${appLabel}.target`, { maxLength: 500 });
    }
    hasApplication ||=
      applications.length > 0 && typeof applications[0] === "string";
  }
  return hasApplication;
}

function parseCaskRecords(value, source) {
  const upstream = expectArray(value, "Homebrew cask API response");
  if (upstream.length > MAX_UPSTREAM_RECORDS) {
    throw new Error("Homebrew cask API response exceeds the record limit");
  }
  const candidates = [];
  for (const [index, candidate] of upstream.entries()) {
    const label = `Homebrew cask API response[${index}]`;
    const cask = expectObject(candidate, label);
    const token = expectPackageToken(cask.token, `${label}.token`);
    const tap = expectString(cask.tap, `${label}.tap`, { maxLength: 100 });
    const disabled = expectBoolean(cask.disabled, `${label}.disabled`);
    const deprecated = expectBoolean(cask.deprecated, `${label}.deprecated`);
    const stableVersion = optionalString(cask.version, `${label}.version`, 200);
    const summary = optionalString(cask.desc, `${label}.desc`, 1000);
    const names = expectArray(cask.name, `${label}.name`);
    if (names.length > 20) {
      throw new Error(`${label}.name exceeds the entry limit`);
    }
    const displayNames = names.map((name, nameIndex) =>
      expectString(name, `${label}.name[${nameIndex}]`, { maxLength: 300 }),
    );
    if (
      tap !== "homebrew/cask" ||
      disabled ||
      deprecated ||
      stableVersion === null ||
      summary === null ||
      displayNames.length === 0
    ) {
      continue;
    }
    candidates.push({
      appId: appIdForPackageToken(token),
      cask,
      displayName: displayNames[0],
      label,
      stableVersion,
      summary,
      token,
    });
  }
  candidates.sort((left, right) => left.appId.localeCompare(right.appId, "en"));

  const records = [];
  for (const candidate of candidates) {
    if (
      !caskHasApplicationArtifact(
        candidate.cask.artifacts,
        `${candidate.label}.artifacts`,
      )
    ) {
      continue;
    }
    const { appId, displayName, stableVersion, summary, token } = candidate;
    records.push({
      id: appId,
      displayName,
      summary,
      category: categoryFor(token, displayName, summary),
      package: {
        type: "cask",
        token,
        stableVersion,
      },
      support: DETECTION_ONLY_SUPPORT,
    });
    if (records.length === source.recordLimit) {
      break;
    }
  }
  if (records.length < source.recordLimit) {
    throw new Error(
      `Homebrew cask API produced only ${records.length} eligible records`,
    );
  }
  return records.slice(0, source.recordLimit);
}

async function readBoundedResponse(response, label) {
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(`${label} returned non-JSON content type ${contentType}`);
  }
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    Number.parseInt(contentLength, 10) > MAX_DOWNLOAD_BYTES
  ) {
    throw new Error(`${label} exceeds the download size limit`);
  }
  if (!response.body) {
    throw new Error(`${label} returned an empty body`);
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of response.body) {
    totalBytes += chunk.byteLength;
    if (totalBytes > MAX_DOWNLOAD_BYTES) {
      throw new Error(`${label} exceeds the download size limit`);
    }
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks, totalBytes);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error.message}`);
  }
  return { bytes, parsed };
}

async function fetchAndNormalize(source) {
  const response = await fetch(source.url, {
    headers: {
      accept: "application/json",
      "user-agent": USER_AGENT,
    },
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
  });
  const { bytes, parsed } = await readBoundedResponse(response, source.id);
  const retrievedAt = new Date().toISOString();
  const records =
    source.kind === "HOMEBREW_FORMULA_API"
      ? parseFormulaRecords(parsed, source)
      : parseCaskRecords(parsed, source);
  const verifiedAt = new Date().toISOString();
  const sourceSha256 = sha256(bytes);
  const normalized = {
    schemaVersion: 1,
    source: {
      id: source.id,
      url: source.url,
      repositoryUrl: source.repositoryUrl,
      owner: source.owner,
      project: source.project,
      sha256: sourceSha256,
      retrievedAt,
      verifiedAt,
      staleAfterDays: source.staleAfterDays,
    },
    recordKind:
      source.kind === "HOMEBREW_FORMULA_API" ? "formula" : "cask",
    records,
  };
  return {
    source: {
      ...source,
      sha256: sourceSha256,
      retrievedAt,
      verifiedAt,
    },
    normalized,
  };
}

async function installStagedFiles(replacements, backupDir) {
  const backups = [];
  const installed = [];
  await mkdir(backupDir, { recursive: false });
  try {
    for (const replacement of replacements) {
      const backupPath = path.join(backupDir, replacement.backupName);
      try {
        await copyFile(replacement.targetPath, backupPath);
        backups.push({ backupPath, targetPath: replacement.targetPath });
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
      await rename(replacement.stagedPath, replacement.targetPath);
      installed.push(replacement.targetPath);
    }
  } catch (installError) {
    const rollbackErrors = [];
    for (const targetPath of installed.reverse()) {
      try {
        await rm(targetPath, { force: true });
      } catch (error) {
        rollbackErrors.push(error);
      }
    }
    for (const backup of backups.reverse()) {
      try {
        await copyFile(backup.backupPath, backup.targetPath);
      } catch (error) {
        rollbackErrors.push(error);
      }
    }
    if (rollbackErrors.length > 0) {
      const rollbackFailure = new AggregateError(
        [installError, ...rollbackErrors],
        "Corpus refresh failed and rollback was incomplete",
      );
      rollbackFailure.preserveBackup = true;
      throw rollbackFailure;
    }
    throw installError;
  }
}

async function main() {
  const releaseLock = await acquireCorpusMaintenanceLock("refresh");
  try {
    const { value: manifestValue } = await readJson(
      MANIFEST_PATH,
      "source manifest",
    );
    const manifest = validateManifest(manifestValue, {
      requireSnapshots: false,
      enforceFreshness: false,
    });
    const { value: overlaysValue } = await readJson(
      OVERLAYS_PATH,
      "managed overlays",
    );
    validateOverlays(overlaysValue, manifest);

    const refreshId = `${process.pid}-${randomUUID()}`;
    const stagingDir = path.join(CORPUS_DIR, `.refresh-staging-${refreshId}`);
    const stagingRawDir = path.join(stagingDir, "raw");
    const backupDir = path.join(CORPUS_DIR, `.refresh-backup-${refreshId}`);
    let preserveBackup = false;
    await mkdir(stagingRawDir, { recursive: true });

    try {
      const normalizedSources = await Promise.all(
        manifest.sources.map(fetchAndNormalize),
      );
      const updatedSources = [];
      const replacements = [];

    for (const result of normalizedSources) {
      const normalizedText = canonicalJson(result.normalized);
      const normalizedSha256 = sha256(normalizedText);
      const updatedSource = {
        ...result.source,
        normalizedSha256,
      };
      updatedSources.push(updatedSource);
      validateNormalizedSource(result.normalized, updatedSource);

      const stagedPath = path.join(
        stagingRawDir,
        path.basename(result.source.rawPath),
      );
      await writeFile(stagedPath, normalizedText, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o644,
      });
      const stagedText = await readFile(stagedPath, "utf8");
      if (sha256(stagedText) !== normalizedSha256) {
        throw new Error(`Staged digest mismatch for ${result.source.id}`);
      }
      replacements.push({
        stagedPath,
        targetPath: resolveCorpusPath(result.source.rawPath),
        backupName: path.basename(result.source.rawPath),
      });
    }

    const updatedManifest = {
      ...manifest,
      sources: updatedSources,
    };
    validateManifest(updatedManifest, { requireSnapshots: true });
    validateOverlays(overlaysValue, updatedManifest);
    const stagedManifestPath = path.join(stagingDir, "source-manifest.json");
    await writeFile(stagedManifestPath, canonicalJson(updatedManifest), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o644,
    });
    replacements.push({
      stagedPath: stagedManifestPath,
      targetPath: MANIFEST_PATH,
      backupName: "source-manifest.json",
    });

    await mkdir(path.join(CORPUS_DIR, "raw"), { recursive: true });
    await installStagedFiles(replacements, backupDir);
    console.log(
      `Refreshed ${updatedSources.length} official sources with ${normalizedSources
        .map((result) => result.normalized.records.length)
        .join(" + ")} normalized records.`,
    );
    } catch (error) {
      preserveBackup = error.preserveBackup === true;
      throw error;
    } finally {
      await rm(stagingDir, { recursive: true, force: true });
      if (!preserveBackup) {
        await rm(backupDir, { recursive: true, force: true });
      }
    }
  } finally {
    await releaseLock();
  }
}

main().catch((error) => {
  console.error(`Corpus refresh failed: ${error.message}`);
  process.exitCode = 1;
});
