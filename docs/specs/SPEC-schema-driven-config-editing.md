# Spec: schema-driven-config-editing

Status: Approved on 2026-09-22. This is an incremental revision of
`SPEC-config-management.md`, `SPEC-configuration-platform.md`, and the
configuration workspace requirements in `SPEC-desktop-experience.md`.

## Assumptions

1. Existing specialized adapters remain valid compatibility behavior while
   schema-driven rendering is introduced.
2. Structured editing is available only when a validated schema, compatible
   adapter, validator, sensitivity policy, and write policy all agree.
3. Presets generate proposed field changes; they never execute writes.
4. Raw editing remains explicitly Advanced and available only where the
   existing document write policy permits it.
5. All mutations retain preview, confirm, backup, atomic write, post-write
   validation, and rollback.
6. The first schema-driven migration applications are Git, Caddy, GitHub
   Copilot CLI, npm, OpenSSH, and Zsh.

## Objective

Render safe structured configuration forms from catalog-owned schemas and let
users apply complete templates, field groups, and recommended-value sets
without application-specific UI branches. The editor must make the target,
source, changed fields, validation result, sensitive-value handling, and
rollback behavior understandable before any write occurs.

### Target users

- Users who prefer safe forms for common configuration.
- Advanced users who need an approved raw editor and exact diff.
- Maintainers adding support through data rather than bespoke React branches.
- Security reviewers validating that schemas and presets cannot bypass the
  existing write coordinator.

## Core Capabilities

### Initial migration scope

- Git: `~/.gitconfig`
- Caddy: `${HOMEBREW_PREFIX}/etc/Caddyfile`
- GitHub Copilot CLI: approved documents below `~/.copilot`
- npm: `~/.npmrc`
- OpenSSH: `~/.ssh/config`
- Zsh: `~/.zshrc`

Each application migrates only after its schema, adapter, validator,
sensitivity policy, write policy, and existing specialized-editor parity are
verified. A migration does not add a new writable path or remove the
compatibility editor before parity is demonstrated.

### Schema-driven rendering

- Dispatch by `editorKey`, schema field kind, and document capabilities, never
  by `appId`.
- Support the approved initial field kinds only: boolean, bounded integer,
  bounded string, enum, string list, and replacement-only secret.
- Render field label, help text, source citation, current state, constraint
  feedback, and applicability.
- Unsupported or unknown field kinds disable structured editing for that
  document and return a typed diagnostic; raw editing is not enabled as a
  fallback unless already authorized.
- Field groups define navigation/organization without changing values.

### Preset application

- Complete templates, field groups, and recommended-value sets are visually
  distinct.
- Selecting a preset shows its source, applicability, changed field count, and
  warnings before it alters the local draft.
- Applying a preset changes the draft only; it does not create an operation or
  write.
- A second explicit action generates the normal write preview.
- Preset conflicts, version mismatch, unavailable fields, and secret-bearing
  values fail closed with no partial application.
- Users can reset the draft to the current document without filesystem writes.

### Validation and diagnostics

- Client-side constraints provide immediate feedback but are not authoritative.
- Rust resolves the catalog definition and schema, revalidates the typed patch,
  invokes the approved adapter and validator, and calculates the diff.
- Errors identify safe field IDs and remediation without raw secrets, stack
  traces, or absolute paths.
- Invalid input cannot be previewed as successful.
- Unknown keys and unmanaged sections are preserved by the adapter's existing
  round-trip contract.

### Safe mutation workflow

1. Read the catalog-authorized document and current content hash.
2. Decode the schema and current structured projection.
3. Edit fields or apply a preset to the local draft.
4. Send a typed field patch with `appId`, `configId`, `schemaId`, schema
   version, and expected content hash.
5. Rust validates schema compatibility, field constraints, adapter,
   sensitivity, and document write policy.
6. Generate an `OperationPreview` and redacted diff.
7. Require explicit confirmation of the operation ID.
8. Recheck target, schema version, intent, and current hash.
9. Create a protected backup.
10. Preserve permissions and safe symlink target, flush, and atomically
    replace.
11. Re-read and post-validate.
12. Restore the backup on post-write failure and report failure.

### Visual and accessibility behavior

- The editor fits inside its pane at 1120 by 720; only the editor pane scrolls.
- Labels remain visible and associated with controls.
- Validation summary links or focuses the invalid field.
- Preset controls, raw/structured mode, Preview, Cancel, and Confirm are
  keyboard reachable with visible focus.
- Long labels and help text wrap; field controls do not overlap at 200% text
  zoom.
- Secret values are never prefilled from the backend; unchanged placeholders
  are represented by typed state, not literal `[REDACTED]` submitted by the
  user interface.

## Tech Stack

| Area | Choice |
|---|---|
| UI | React 19, strict TypeScript |
| Styling/layout | `desktop-visual-consistency` primitives and Tailwind 4 |
| Schema/presets | `config-schema-presets` independently versioned packaged data |
| IPC | Existing validated Tauri invoke wrappers |
| Backend | Rust adapters, validators, config coordinator |
| Mutation safety | Existing operations, backup, atomic write, restore |

No generic form library, JSON Schema runtime, or state-management dependency is
approved by this specification.

## Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build
pnpm test:e2e
pnpm build:unsigned
```

## Project Structure

```text
src/features/apps/ConfigWorkspace.tsx
src/features/apps/editors/
  ConfigAdapterEditor.tsx          existing capability dispatch
  SchemaDrivenEditor.tsx           proposed generic field renderer
  PresetPicker.tsx                 proposed preset draft application
  configEditorCapabilities.ts      editor capability registry
  types.ts                         typed editor contracts
src/ipc/config.ts                  typed read/preview/execute/restore
src/ipc/configSchemas.ts           proposed schema/preset IPC decoder

src-tauri/src/config/
  adapters/                        format/application semantic round trips
  validation/                      authoritative validation
  write.rs                         conflict, backup, atomic replacement
  restore.rs                       restore through same safety path
src-tauri/src/commands/config.rs    thin typed command boundary
src-tauri/src/catalog/             schema/preset validation and lookup
```

## Code Style

Use a discriminated renderer and typed patch:

```tsx
function ConfigFieldControl({
  field,
  value,
  onChange,
}: ConfigFieldControlProps) {
  switch (field.kind) {
    case "BOOLEAN":
      return (
        <BooleanField
          checked={value === true}
          label={field.label}
          onChange={(checked) => onChange(field.fieldId, checked)}
        />
      );
    case "ENUM":
      return (
        <EnumField
          label={field.label}
          options={field.options}
          value={typeof value === "string" ? value : ""}
          onChange={(next) => onChange(field.fieldId, next)}
        />
      );
    case "SECRET":
      return <SecretReplacementField field={field} onChange={onChange} />;
  }
}
```

The backend command remains narrow:

```rust
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SchemaConfigWriteInput {
    app_id: String,
    config_id: String,
    schema_id: String,
    schema_version: u16,
    expected_hash: String,
    fields: serde_json::Value,
}
```

Conventions:

- No `appId` conditionals in generic rendering.
- No `any`, unchecked casts, or silent coercion.
- Preserve explicit loading, diagnostic, preview, execution, and result state
  unions.
- Errors remain safe and typed; no broad catches that return empty config.

## Testing/Verification Strategy

- Reuse existing editor Vitest files to cover field rendering, local draft
  changes, preset selection, validation display, and secret replacement.
- Reuse existing `src/ipc/config.test.ts` for request/response decoding and
  unknown schema failure.
- Reuse Rust adapter, validation, write, and restore test modules for
  round-trip preservation, conflict detection, backup, atomic replacement,
  post-validation, and rollback.
- Reuse WDIO for the complete read → edit/preset → preview → confirm → result
  flow against the isolated E2E home.
- Manual acceptance verifies long labels, keyboard flow, screen-reader names,
  redacted diffs, and recovery from validation/conflict failures.
- New test files require explicit approval; implementation should extend
  existing files where practical.

## Boundaries

### Always

- Resolve schema, document, adapter, validator, sensitivity, and write policy
  on the Rust side from catalog-owned IDs.
- Preserve unknown/unmanaged content and current-hash conflict detection.
- Show validation and redacted diff before confirmation.
- Create a protected backup, atomically replace, post-validate, and roll back
  on failure.
- Keep secret current values out of IPC and treat replacements as write-only.

### Ask first

- Add a new field kind, generic form dependency, parser, writable format,
  whole-document template replacement, new test file, or schema-based
  privileged target.
- Remove or change an existing specialized editor before parity is proven.

### Never

- Accept a filesystem path, adapter ID, validator ID, or arbitrary command from
  the frontend.
- Write directly from a field change or preset selection.
- Return secret values in document, diff, error, log, event, or operation
  history payloads.
- Bypass preview/confirm/backup/atomic write/post-validation/rollback for
  schema-driven edits.
- Treat failed schema decoding as permission to use raw editing.

## Dependency Interfaces

### Consumes from `desktop-visual-consistency`

- Compact field, toolbar, grouped-row, inspector, focus, contrast, wrapping,
  and pane-scroll contracts.

### Consumes from `config-schema-presets`

```typescript
interface SchemaEditorModel {
  schema: ConfigSchemaDefinition;
  presets: readonly ConfigPresetDefinition[];
  currentFields: Readonly<Record<string, unknown>>;
}
```

### Provides to `application-browsing`

```typescript
interface ConfigEditingCapabilitySummary {
  appId: string;
  configId: string;
  schemaId?: string;
  structured: boolean;
  raw: boolean;
  presetKinds: readonly ConfigPresetKind[];
  disabledReason?: string;
}
```

### Typed mutation interface

```text
get_config_schema(appId, configId) -> ConfigSchemaPresentation
preview_schema_config_write(input) -> ConfigWritePreview
execute_config_write(operationId) -> OperationDetails
```

`execute_config_write` remains the existing operation-ID-gated endpoint; no
second write path is introduced.

## Success Criteria

1. Git, Caddy, GitHub Copilot CLI, npm, OpenSSH, and Zsh each have an approved
   migration path that retains their compatibility editor until parity is
   demonstrated.
2. Every schema-supported field renders without an `appId` branch, and unknown
   field kinds produce a typed disabled state rather than a generic or raw
   writable fallback.
3. Applying any preset changes zero filesystem bytes and displays its source,
   applicability, warnings, and exact changed-field count before preview.
4. A structured write cannot execute until the user receives a validated,
   redacted preview and explicitly confirms its unexpired operation ID.
5. Concurrent modification, schema-version mismatch, adapter mismatch, invalid
   field value, or post-write validation failure produces non-success and never
   leaves an unvalidated replacement in place.
6. Backup restoration reproduces prior bytes and permissions, and safe symlinks
   remain symlinks after successful write/restore.
7. Secret values appear in zero IPC read payloads, previews, diffs, logs,
   errors, and operation-history records.
8. At 1120 by 720 and 200% text zoom, every field, validation message, preset
   action, Preview action, and confirmation control remains reachable through
   editor-pane scrolling without document-level overflow.

## Open Questions

- Whole-document complete templates may require stricter wording and a separate
  confirmation step; enabling them for existing files is an **Ask first**
  decision.
- The maximum supported fields per schema and presets per document need bounded
  values based on corpus measurements before implementation.
