import {
  GENERATED_PATH,
  RUNTIME_CATALOG_PATH,
  SUMMARY_PATH,
  loadAndValidateInputs,
  readJson,
  sha256,
  validateGenerated,
  validateSummary,
} from "./common.mjs";

async function main() {
  const { manifest, overlays, rawSources } = await loadAndValidateInputs();
  const formulaSource = rawSources.find(
    (source) => source.recordKind === "formula",
  );
  const caskSource = rawSources.find((source) => source.recordKind === "cask");
  if (
    formulaSource.records.length < manifest.policy.minimumFormulaRecords ||
    caskSource.records.length < manifest.policy.minimumCaskRecords
  ) {
    throw new Error("Normalized Homebrew source record minimum was not met");
  }

  const { value: generatedValue, text: generatedText } = await readJson(
    GENERATED_PATH,
    "generated catalog",
  );
  const generated = validateGenerated(generatedValue, manifest);
  const artifactSha256 = sha256(generatedText);
  const { value: summaryValue } = await readJson(
    SUMMARY_PATH,
    "summary report",
  );
  validateSummary(summaryValue, generated, artifactSha256);
  const { value: runtimeCatalog } = await readJson(
    RUNTIME_CATALOG_PATH,
    "runtime catalog",
  );
  if (
    runtimeCatalog.schemaVersion !== 1 ||
    !Array.isArray(runtimeCatalog.apps) ||
    runtimeCatalog.apps.length !== generated.applications.length
  ) {
    throw new Error("Runtime catalog does not match the packaged application set");
  }
  const runtimeIds = new Set(runtimeCatalog.apps.map((app) => app.id));
  if (
    runtimeIds.size !== runtimeCatalog.apps.length ||
    generated.applications.some((app) => !runtimeIds.has(app.id))
  ) {
    throw new Error("Runtime catalog application IDs do not match the corpus");
  }
  const managedIds = new Set(manifest.managedOverlayIds);
  const unsafeGeneratedApp = runtimeCatalog.apps.find(
    (app) =>
      !managedIds.has(app.id) &&
      (app.coverageClass !== "DETECTED_UNSUPPORTED" ||
        app.capabilities.length !== 1 ||
        app.capabilities[0] !== "DETECT" ||
        app.configDocuments.length !== 0 ||
        app.services.length !== 0),
  );
  if (unsafeGeneratedApp) {
    throw new Error(
      `Detection-only runtime application ${unsafeGeneratedApp.id} gained unsupported authority`,
    );
  }

  console.log(
    `Validated ${formulaSource.records.length} formulae, ${caskSource.records.length} casks, ${overlays.applications.length} overlays, and ${generated.applications.length} unique packaged applications.`,
  );
  console.log(`Packaged catalog sha256: ${artifactSha256}`);
}

main().catch((error) => {
  console.error(`Corpus validation failed: ${error.message}`);
  process.exitCode = 1;
});
