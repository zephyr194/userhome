# Spec: config-schema-presets

Status: Approved on 2026-09-22. This is an incremental revision of
`SPEC-app-catalog.md`, `SPEC-config-management.md`, and
`SPEC-configuration-platform.md`.

## Assumptions

1. Schema and preset data are packaged with the application and validated
   before runtime use.
2. Schema definitions and preset definitions use two independently versioned
   canonical files.
3. A schema describes only catalog-authorized configuration documents; it does
   not introduce new paths, executables, validators, or privilege.
4. Presets are suggestions that produce a previewable patch, not direct writes.
5. The three approved preset forms are complete templates, field groups, and
   recommended-value sets.

## Objective

Define a stable, typed, versioned contract for configuration field schemas and
presets so applications can expose structured editing without hard-coded React
components per `appId`. The module must preserve unknown settings, prevent
secret disclosure, reject ambiguous or incompatible data, and remain usable by
both the curated corpus pipeline and the runtime editor.

### Target users

- End users who want safe structured controls instead of editing raw text.
- Advanced users who need transparent diffs and can fall back to approved raw
  editing.
- Maintainers who curate official configuration knowledge without adding UI
  branches.
- Reviewers who need to see exactly which paths, fields, sources, and
  validators authorize a mutation.

## Core Capabilities

### Schema model

Each schema is keyed by stable `schemaId` and version and is bound to an
existing catalog `configId`. It declares:

- Field ID, display label, description, data type, optionality, default, and
  ordering.
- Object path or format-specific semantic key; never a filesystem path.
- Constraints such as enum values, numeric bounds, string length, or pattern.
- Sensitivity: `STANDARD`, `SENSITIVE`, or `SECRET`.
- Read behavior, write behavior, and whether an unchanged redacted placeholder
  may be restored from current content.
- Applicability by app version, document variant, platform, or feature flag.
- Official source references and last verification metadata.
- Adapter and validator capabilities required to round-trip the field.

Unsupported schema version, field type, merge strategy, adapter, validator,
sensitivity, or source state fails closed.

### Independent versioning

- Schemas are stored in `schemas-v<version>.json`; presets are stored in
  `presets-v<version>.json`.
- Each file declares and validates its own format version.
- A preset declares the schema ID and compatible schema version range it
  targets.
- Updating one file never implies that the other file is compatible; cross-file
  references are validated before either is exposed at runtime.
- Unknown or incompatible schema/preset file versions produce a typed
  non-success result and no editor capability.

### Preset kinds

1. **Complete template:** proposes a complete schema-owned structured value set
   for a new or intentionally replaced document. It may not silently erase
   unmanaged keys or sections.
2. **Field group:** selects and groups related fields for focused editing, but
   carries no values unless explicitly combined with a recommended-value set.
3. **Recommended-value set:** proposes values for a subset of fields and
   explains why and for which app versions they are recommended.

Every preset has a stable `presetId`, version, label, description, kind,
applicability conditions, source references, proposed fields, and merge
strategy. Applying a preset yields a typed patch and impact summary; it never
writes directly.

### Merge and conflict rules

- Unknown and unmanaged keys are preserved.
- A recommended-value set changes only listed fields.
- A field group changes no value by itself.
- A complete template may replace only the schema-owned projection; replacing
  a whole file requires the document's approved round-trip adapter and explicit
  confirmation in the editing module.
- Secret fields never carry defaults or literal values in the corpus.
- Incompatible presets return a typed diagnostic rather than a partially
  applied result.
- Preset ordering is deterministic; later implicit override is prohibited.

## Tech Stack

| Area | Choice |
|---|---|
| Canonical schema data | Independently versioned JSON packaged under `src-tauri/src/catalog/` |
| Canonical preset data | Independently versioned JSON packaged under `src-tauri/src/catalog/` |
| Validation | Rust `serde`/`serde_json` plus explicit allowlists |
| Frontend contract | Strict TypeScript decoders in `src/ipc/` |
| Runtime | Existing Tauri invoke boundary |
| Mutation | Existing config adapters and operation coordinator |

Prefer current dependencies. Zod is named in the umbrella spec but is not
currently installed; adding or replacing decoder tooling requires approval.

## Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build
```

No schema generator or dependency installation command is approved by this
specification.

## Project Structure

```text
src-tauri/src/catalog/
  catalog-v1.json                 existing application/document catalog
  schemas-v1.json                 packaged field schemas, independently versioned
  presets-v1.json                 packaged preset definitions, independently versioned
  mod.rs                          bounded decoding and validation
  schema.rs                       proposed schema domain types
  presets.rs                      proposed preset domain types and merge checks

src/ipc/
  catalog.ts                      existing catalog presentation decoder
  configSchemas.ts               proposed typed schema/preset decoder

src/features/apps/editors/
  types.ts                        schema-driven editor contracts

docs/
  managed-app-schema.md           maintainer rules and examples
```

Exact filenames beyond the two-file versioning contract are planning inputs,
not implementation authorization.

## Code Style

Use explicit discriminated unions and stable IDs:

```typescript
type ConfigField =
  | {
      fieldId: string;
      kind: "BOOLEAN";
      label: string;
      sensitivity: "STANDARD" | "SENSITIVE";
    }
  | {
      fieldId: string;
      kind: "ENUM";
      label: string;
      options: readonly { value: string; label: string }[];
      sensitivity: "STANDARD" | "SENSITIVE";
    }
  | {
      fieldId: string;
      kind: "SECRET";
      label: string;
      replacementOnly: true;
    };
```

Canonical preset data remains declarative:

```json
{
  "presetId": "git-safe-defaults",
  "kind": "RECOMMENDED_VALUES",
  "schemaId": "git-global-config",
  "values": {
    "init-default-branch": "main",
    "pull-rebase": false
  }
}
```

Conventions:

- IDs are kebab-case and never derived from labels or user content.
- Rust uses `snake_case` internally and `camelCase` serialization.
- Unknown fields are denied in canonical persisted/corpus structures.
- Avoid `any`, unchecked casts, boolean “supported” flags, and generic maps at
  security boundaries.

## Testing/Verification Strategy

- Reuse current Rust catalog tests to validate size bounds, unique IDs,
  allowlists, independent schema/preset versions, and fail-closed behavior.
- Reuse current frontend IPC tests to validate discriminated unions, limits,
  duplicate detection, and cross-file invariants.
- Reuse current config adapter tests to prove schema projection preserves
  unknown keys and comments where the adapter promises that behavior.
- Manual review checks that every preset cites official sources and that no
  preset embeds credentials, tokens, machine paths, or destructive effects.
- New test files require approval; existing catalog/config test modules may be
  extended only when approved during implementation.

## Boundaries

### Always

- Bind schemas to existing catalog IDs and approved adapter/validator
  capabilities.
- Validate schema/preset version, identifiers, sizes, types, constraints,
  applicability, source references, and merge strategy before exposure.
- Preserve unknown keys and unmanaged sections.
- Treat secret fields as replacement-only and omit values from reads, corpus,
  diffs, errors, and diagnostics.

### Ask first

- Add a new field type, merge strategy, writable format family, parser
  dependency, new test file, or preset capable of replacing an entire
  document.
- Change schema or preset compatibility and deprecation policy.

### Never

- Let a schema or preset grant path, command, service, or elevation authority.
- Store literal credentials, tokens, private keys, or user-specific paths.
- Apply a preset directly or interpret missing data as permission to delete.
- Fall back to a generic writable editor when schema decoding fails.

## Dependency Interfaces

### Provides

```typescript
interface ConfigSchemaDefinition {
  schemaId: string;
  schemaVersion: number;
  appId: string;
  configId: string;
  fields: readonly ConfigField[];
  requiredCapabilities: {
    adapterId: string;
    validatorId: string;
  };
  sources: readonly SourceReference[];
}

type ConfigPresetKind =
  | "COMPLETE_TEMPLATE"
  | "FIELD_GROUP"
  | "RECOMMENDED_VALUES";

interface ConfigPresetDefinition {
  presetId: string;
  presetVersion: number;
  schemaId: string;
  compatibleSchemaVersions: {
    minimum: number;
    maximum: number;
  };
  kind: ConfigPresetKind;
  fieldIds: readonly string[];
  values?: Readonly<Record<string, unknown>>;
  sourceIds: readonly string[];
}

interface PresetPatch {
  schemaId: string;
  presetId: string;
  changedFields: readonly string[];
  proposedFields: Readonly<Record<string, unknown>>;
  warnings: readonly string[];
}
```

These contracts are consumed by `open-source-config-sourcing` and
`schema-driven-config-editing`.

### Consumes

- Catalog-owned `appId`, `configId`, `adapterId`, `validatorId`,
  `writePolicy`, sensitivity, and path-variant metadata.
- No dependency on UI layout or online source fetching.

## Success Criteria

1. The independently versioned schema and preset files validate
   deterministically, with zero duplicate IDs and zero unresolved `appId`,
   `configId`, field, adapter, validator, schema-version, or source references.
2. The model represents all three approved preset kinds and rejects a preset
   whose values reference fields outside its schema.
3. Applying a recommended-value preset changes exactly its declared fields; a
   field-group preset changes zero values; unknown config keys remain byte- or
   semantic-equivalent according to the adapter contract.
4. No `SECRET` field has a corpus default, recommended literal, readable
   current value, or unredacted diff representation.
5. Unknown schema versions, preset versions, field kinds, constraints, or merge
   strategies produce a typed non-success result and no editor capability.
6. A new data-only schema using already-approved field types, adapters, and
   validators requires no `appId` branch in React or Rust.

## Open Questions

- The initial supported field-kind set should be minimized; candidate kinds
  beyond boolean, string, integer, enum, string-list, and replacement-only
  secret require explicit review.
- Preset deprecation and aliasing rules need an owner and retention period
  before the first breaking schema revision.
