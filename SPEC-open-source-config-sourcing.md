# Spec: open-source-config-sourcing

Status: Approved on 2026-09-22. This is an incremental revision of the
data-first catalog extension rules in `SPEC-app-catalog.md`,
`SPEC-catalog-expansion.md`, and `SPEC-configuration-platform.md`.

## Assumptions

1. Source collection occurs only during maintenance or CI; the shipped
   application never fetches source material at runtime.
2. Only official vendor/project documentation and official vendor/project
   repositories are accepted.
3. The output is a curated, reviewed, versioned offline corpus, not an
   automatically trusted scrape.
4. Source evidence informs schemas and presets but never grants write authority
   by itself.

## Objective

Create a deterministic provenance pipeline and review contract for deriving
configuration schemas, presets, application metadata, and source citations
from authoritative open-source materials while preserving UserHome's
local-first and fail-closed guarantees.

### Target users

- Maintainers curating configuration support.
- Security reviewers validating provenance, sensitivity, and authorization.
- End users who need offline browsing and clear source attribution.
- CI operators who need deterministic checks without publishing credentials or
  downloading mutable content during product runtime.

## Core Capabilities

### Accepted sources

- Official documentation hosted on the project's or vendor's documented
  domain.
- Official source repositories owned by the project/vendor organization.
- Versioned files, tags, releases, or commit SHAs within those repositories.
- Official schema files or settings-reference documents maintained by the
  project.

The following are rejected: community wikis, blogs, gists, snippets, package
mirrors, search-result summaries, generated AI answers, issue comments without
maintainer documentation status, forks, and unofficial examples.

### Source record

Every imported fact has a stable source record containing:

- `sourceId`, source kind, canonical HTTPS URL, official owner/project.
- Immutable revision where available: commit SHA, tag, or release version.
- Retrieved timestamp and content digest.
- License identifier or review status.
- Scope: app identity, field schema, preset, path hint, version range, or
  documentation text.
- Human reviewer and approval state outside the runtime payload.
- Sanitized excerpt location or JSON pointer; no copied secret values.

Mutable branch URLs may be used only to discover an immutable revision during
maintenance; accepted corpus entries pin the immutable revision or record a
content digest.

### Curation and generation

- Retrieval and normalization are separate from approval.
- Generated candidate entries remain unapproved until validation and human
  review succeed.
- The committed/package-ready corpus is sorted and serialized
  deterministically.
- The same inputs produce byte-identical normalized output.
- A source disappearing or changing does not silently rewrite the packaged
  corpus.
- CI may report stale or unreachable sources, but the runtime continues using
  the last approved packaged corpus.

### Safety classification

- Source text is untrusted input even when official.
- Paths are converted into catalog root aliases and bounded relative paths.
- Examples containing tokens, credentials, private keys, usernames, absolute
  home paths, telemetry payloads, logs, databases, caches, or runtime state are
  excluded or reduced to non-sensitive metadata.
- A documented setting is not writable until a reviewed adapter, round-trip
  strategy, validator, sensitivity policy, and editor capability exist.
- Unknown source formats and schema constructs fail closed.

### Runtime delivery

- The packaged corpus contains normalized application metadata, schemas,
  presets, source citations, and compatibility metadata required by the UI.
- Runtime IPC returns only bounded, typed, sanitized corpus data.
- Runtime has no fetch URL, arbitrary repository selector, access token, or
  source-ingestion command exposed to the WebView.

## Tech Stack

| Area | Choice |
|---|---|
| Maintenance scripts | Existing Node.js 24 or Rust toolchain |
| Canonical records | Versioned JSON with stable ordering |
| Validation | Rust catalog/schema validators and TypeScript decoders |
| CI | Existing GitHub Actions repository workflows |
| Runtime | Packaged static corpus loaded by Rust |
| Integrity | Content digests; pinned revisions where available |

Prefer standard-library HTTP/file capabilities available to the selected
maintenance environment. Adding an HTTP, HTML, YAML, GitHub API, or license
parsing dependency requires approval.

## Commands

Proposed canonical maintenance commands to be finalized during planning:

```bash
# Validate the already-packaged corpus; no network access
pnpm corpus:validate

# Check deterministic normalization without writing repository files
pnpm corpus:check

# Maintainer-only refresh from approved source manifest
pnpm corpus:refresh -- --source-manifest docs/config-sources.json

# Normal repository verification
pnpm lint
pnpm typecheck
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build
```

These scripts do not exist yet. Adding them or changing CI is an **Ask first**
implementation action. Runtime startup must not invoke refresh.

## Project Structure

```text
docs/config-sources.json                 proposed approved source manifest
docs/managed-app-schema.md               source and curation rules
scripts/config-corpus/                    proposed maintenance-only tooling
src-tauri/src/catalog/corpus-v1.json      proposed packaged normalized corpus
src-tauri/src/catalog/schema.rs           typed validation
src-tauri/src/catalog/presets.rs          typed preset validation
.github/workflows/                        optional scheduled/manual corpus check
```

Fetched raw material belongs in an ephemeral CI/temp directory and is not
packaged unless explicitly normalized and approved.

## Code Style

Use explicit source states and immutable identifiers:

```rust
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceReference {
    source_id: String,
    kind: SourceKind,
    canonical_url: String,
    revision: String,
    content_sha256: String,
    scope: SourceScope,
}

enum SourceDecision {
    Accepted(ValidatedSource),
    NeedsReview(SourceDiagnostic),
    Rejected(SourceRejectionReason),
}
```

Do not turn a fetch failure into an empty successful corpus, and do not use
free-form source records where typed fields can enforce invariants.

## Testing/Verification Strategy

- Reuse current Rust catalog validation tests for bounds, identifiers,
  duplicate references, path aliases, and unknown-enum rejection.
- Reuse current IPC tests to reject oversized, malformed, or sensitive source
  presentation payloads.
- Run deterministic normalization twice from the same fixture/input and compare
  digests during maintenance validation.
- Manually review a sample from every source owner and every generated schema
  or preset kind.
- CI validation is read-only with respect to user configuration and runtime
  state.
- New test files, network test fixtures, workflow files, or dependencies require
  approval.

## Boundaries

### Always

- Accept only official documentation and official repositories.
- Pin immutable revisions or content digests and preserve provenance.
- Treat all source content as untrusted until normalized, validated, and
  reviewed.
- Keep runtime corpus access offline, typed, bounded, and sanitized.
- Separate source evidence from catalog write authorization.

### Ask first

- Add a source owner/domain, dependency, new test file, CI workflow, scheduled
  network job, license policy, or automated merge of refreshed corpus.
- Import a format that cannot be validated by existing schema/preset types.

### Never

- Fetch source material during normal app startup, browsing, or editing.
- Accept unofficial repositories, forks, blogs, gists, community snippets, or
  AI-generated summaries as authority.
- Embed credentials, access tokens, cookies, private repository content, user
  configuration, or machine-specific paths.
- Promote a documented path to writable without the existing catalog, adapter,
  validator, preview, confirmation, backup, atomic write, post-validation, and
  rollback approvals.

## Dependency Interfaces

### Consumes from `config-schema-presets`

```typescript
interface CorpusSchemaTarget {
  schemaId: string;
  schemaVersion: number;
  supportedFieldKinds: readonly string[];
  supportedPresetKinds: readonly [
    "COMPLETE_TEMPLATE",
    "FIELD_GROUP",
    "RECOMMENDED_VALUES",
  ];
}
```

- Canonical schema, preset, applicability, and source-reference shapes.
- Fail-closed validation rules for unknown fields and versions.

### Provides to `application-browsing`

```typescript
interface CatalogCorpusEntry {
  appId: string;
  displayName: string;
  category: string;
  description: string;
  iconKey: string;
  coverageClass:
    | "MANAGED_WRITABLE"
    | "MANAGED_READ_ONLY"
    | "DETECTED_UNSUPPORTED"
    | "EXCLUDED";
  schemaIds: readonly string[];
  presetIds: readonly string[];
  sourceIds: readonly string[];
}

interface CorpusManifest {
  corpusVersion: number;
  generatedAt: string;
  entryCount: number;
  contentSha256: string;
  entries: readonly CatalogCorpusEntry[];
}
```

Only safe citations and normalized metadata reach the UI. Reviewer identities,
credentials, raw source bodies, and maintenance internals are not runtime IPC.

## Success Criteria

1. 100% of packaged applications, schemas, and presets reference at least one
   accepted official source record; zero accepted records point to unofficial
   domains or repositories.
2. Every accepted source has an immutable revision or content digest, and
   normalization from unchanged inputs is byte-identical across two runs.
3. Runtime browsing and editing succeed with network access disabled; runtime
   exposes no source-fetch command or credential.
4. Source validation rejects unknown owners, unsupported schemes, mutable-only
   records without a digest, duplicate IDs, dangling references, and
   secret-bearing preset values.
5. A source refresh failure leaves the last approved corpus intact and causes a
   non-success maintenance/CI result rather than an empty or partially trusted
   corpus.
6. No source fact alone changes a document from read-only/unsupported to
   writable; write support still requires all catalog and config-safety
   capabilities.

## Open Questions

- The initial allowlist of official domains and repository owners must be
  recorded during planning.
- The corpus refresh cadence, approval owner, and staleness threshold remain
  implementation-plan decisions.
- License metadata requirements for short normalized facts versus bundled
  schema files need legal/project-owner confirmation.
