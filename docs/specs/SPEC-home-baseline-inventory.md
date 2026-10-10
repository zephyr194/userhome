# Spec: home-baseline-inventory

Status: Approved on 2026-09-21

## Objective

Use the current Mac as a concrete configuration-coverage baseline without
turning UserHome into a recursive file manager. The module identifies
application configuration roots, records safe metadata, and produces a stable
coverage manifest consumed by `configuration-platform` and
`catalog-expansion`.

The target user is the current local macOS user. No account, upload, telemetry,
or remote inventory is involved.

## Baseline Scope

The baseline inventory considers bounded metadata under:

- Home-directory top-level dot directories.
- `${XDG_CONFIG_HOME}` or `~/.config`.
- `~/Library/Application Support`.
- Catalog-owned files directly below the home directory.
- Trusted Homebrew prefixes and catalog-defined service locations.

The baseline observed on 2026-09-21 includes substantially more developer
software than the current 12-entry catalog, including AI tools, editors,
terminals, package managers, cloud tools, containers, and productivity
applications. Raw usernames, file contents, credentials, and unrestricted
directory listings are not committed.

## Inventory Model

Each candidate record contains:

```text
candidateId
displayName
rootKind
relativePath
entryType
evidence[]
formatHints[]
sensitivityHint
coverageClass
classificationReason
catalogAppId?
```

Rules:

- `candidateId` is deterministic and does not contain an absolute home path.
- `relativePath` uses `~`, `XDG_CONFIG_HOME`, `APPLICATION_SUPPORT`, or
  `HOMEBREW_PREFIX`.
- Only names, types, bounded sizes, modification times, and catalog matches are
  collected during discovery.
- Content is opened only through a catalog-authorized configuration document.
- Every emitted candidate has exactly one coverage class and a human-readable
  reason.

## Discovery Strategy

- Use exact catalog probes first.
- Enumerate only the approved root's direct children for baseline candidate
  discovery.
- Descend only through an approved application profile that specifies finite
  depth, entry count, metadata count, and timeout.
- Apply exclusion rules before opening content.
- Treat aliases, symlinks, unreadable paths, and permission failures as explicit
  results rather than silently omitting them.
- Keep runtime scans bounded and deterministic. A developer-only baseline
  command may produce a sanitized manifest for catalog work but must not ship
  raw local paths or contents.

## Coverage Contract

Completeness means:

1. Every safely identifiable baseline configuration root is represented.
2. Every represented root is `MANAGED_WRITABLE`, `MANAGED_READ_ONLY`,
   `DETECTED_UNSUPPORTED`, or `EXCLUDED`.
3. Every unsupported or excluded root states why.
4. Counts in the coverage summary equal the classified candidate total.
5. No candidate is promoted by discovery alone.

Completeness does not mean recursively reading the entire home directory or
editing all detected data.

## Interfaces and Dependencies

```text
get_baseline_inventory() -> BaselineInventory
get_configuration_coverage() -> ConfigurationCoverage
refresh_baseline_inventory() -> OperationId
export_sanitized_baseline() -> SanitizedBaselineManifest
```

This module has no provider dependency. It provides requirements and safe path
evidence to `configuration-platform` and `catalog-expansion`.

## Tech Stack and Project Structure

```text
src-tauri/src/discovery/          bounded inventory and classification
src-tauri/src/security/           path, symlink, exclusion, and limit policy
src-tauri/src/catalog/            exact probes and coverage ownership
src/ipc/discovery.ts              typed frontend contract
docs/                             sanitized baseline coverage report
```

Use Rust standard filesystem metadata APIs and existing error contracts. Do not
add a general-purpose filesystem plugin.

## Commands and Verification

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
pnpm typecheck
pnpm test:e2e
```

Fixture verification uses temporary homes. Manual baseline comparison may read
metadata from the current user's approved roots but must not mutate them or
commit raw private inventory.

## Acceptance Criteria

- A sanitized baseline report accounts for 100% of candidates emitted from the
  approved roots.
- The report contains no absolute username, configuration content, credential
  name, token, database content, cache entry, log entry, or runtime state.
- Repeated refreshes with unchanged metadata produce the same candidate IDs and
  classifications.
- Permission, symlink, timeout, and entry-limit outcomes are explicit.
- Startup remains responsive and local metadata is available within two seconds
  on the baseline Mac.
- The scanner never recursively traverses the complete home directory.
- The UI can explain where a candidate was found, how it was classified, and
  what is required to increase support.

## Boundaries

### Always

- Classify before reading, cap all enumeration, and normalize displayed paths.
- Use metadata-only discovery for unknown candidates.
- Store raw baseline artifacts outside version control and sanitize exports.

### Ask first

- Add a new scan root, increase depth or entry limits, or inspect content for a
  previously unknown candidate.

### Never

- Scan the whole home directory recursively.
- Read credentials, private keys, databases, caches, logs, sockets, package
  stores, or runtime state as configuration.
- Treat existence as authority to read or write.

## Open Questions

None. The approved coverage model is classification of all safe candidates with
managed access only where safety is proven.
