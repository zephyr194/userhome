# Spec: application-browsing

Status: Approved on 2026-09-22. This is an incremental revision of
`SPEC-catalog-expansion.md`, `SPEC-native-desktop-shell.md`, and the
Applications workspace in `SPEC-desktop-experience.md`.

## Assumptions

1. The current 26-application/36-document built-in catalog grows to at least
   500 application entries.
2. The current Rust and TypeScript hard limits of 32 applications must be
   replaced with reviewed bounds consistent with the 500-entry requirement.
3. Browsing uses dependency-free pagination with exactly 50 applications per
   page; rendering all 500 rows simultaneously is not acceptable.
4. Search and filtering operate on the packaged offline corpus and local
   detection metadata, with no runtime network dependency.
5. Selection, keyboard navigation, and detail/editing state remain stable while
   the visible page changes.

## Objective

Provide a fast, accessible macOS System Settings-style application catalog for
at least 500 entries. Users must be able to search, filter, group, navigate,
select, and inspect applications without unbounded rendering, layout shifts,
focus loss, or weakening the distinction between writable, read-only,
unsupported, and excluded content.

### Target users

- Users locating one application among hundreds by name, category, capability,
  coverage, or source-backed metadata.
- Keyboard users navigating long result sets.
- Users reviewing why an app is detected, supported, unsupported, or excluded.
- Users moving from catalog browsing into schema-driven config editing.

## Core Capabilities

### Catalog scale and loading

- The validated packaged corpus supports at least 500 applications.
- Runtime IPC returns bounded 50-item pages plus total-count and page-count
  metadata. A single unbounded 500-entry detail payload is prohibited.
- Catalog load failure is explicit and does not fall back to an empty success.
- The last known valid packaged corpus remains available if an optional
  maintenance refresh fails.
- Application IDs remain stable, unique, kebab-case identifiers.

### Search, filter, and grouping

- Search covers display name, description, category, app ID, supported
  configuration purpose, format, official-source label, and safe path aliases.
- Filters cover category, coverage class, detected state, writable/read-only
  capability, and preset availability.
- Search is case-insensitive and trims surrounding whitespace.
- Search/filter results update within 100 ms at p95 after input on a corpus of
  500 entries on the baseline Apple Silicon Mac, excluding initial process
  startup.
- Result counts reflect the full filtered set, not only the current page.
- Group headings remain visible or are repeated meaningfully without breaking
  listbox semantics.

### Pagination

- Every full page contains exactly 50 applications; only the final page may
  contain fewer.
- Page count, current page, and displayed result range are explicit.
- Previous, Next, First, Last, and direct page navigation are keyboard
  accessible.
- No more than 50 application rows are mounted for the result list at once.
- Changing page, filter, or query restores or replaces selection
  deterministically: retain the selected app if it remains on the requested
  page; otherwise select the first result without unexpectedly moving focus.
- Arrow Up/Down and Home/End operate within the current page. Page Up/Page Down
  move by one page while preserving the nearest valid row position.
- A page request outside `1..totalPages`, or any page size other than 50, is
  rejected at the typed IPC boundary.

### List/detail behavior

- The list pane owns scrolling and the detail pane does not jump when new
  detection metadata arrives.
- Rows use compact desktop geometry and support one primary line plus bounded
  supporting metadata.
- Long names truncate visually with an accessible full name; descriptions and
  diagnostics live in the detail pane.
- Selection is indicated by more than color and persists for the application
  session when safe.
- Detail distinguishes detection evidence, source provenance, managed
  documents, preset availability, limitations, exclusions, and required work.
- Unsupported and excluded entries expose no edit affordance.

### Editing handoff

- A managed document advertises structured, raw, read-only, and preset
  capabilities from typed data.
- Opening a document delegates to `schema-driven-config-editing`; browsing
  components do not parse or mutate config.
- Returning from editor/detail preserves query, filters, page, scroll position,
  and selected application.
- A catalog entry does not become writable because it has an official source or
  schema; the existing catalog write policy remains authoritative.

### Accessibility and resilience

- The logical list exposes an accurate accessible name, selected item, total
  result count, current page, total pages, and displayed range.
- Roving focus or `aria-activedescendant` follows one documented model.
- Loading, empty, partial, error, and stale-corpus states remain inside the
  affected pane.
- At 200% text zoom, filters and selected details remain reachable without
  horizontal document scrolling.
- Rendering and filtering do not block refresh progress or unrelated routes.

## Tech Stack

| Area | Choice |
|---|---|
| UI | React 19, strict TypeScript |
| Layout | `desktop-visual-consistency` list/detail primitives |
| Data | `open-source-config-sourcing` packaged corpus |
| Editing | `schema-driven-config-editing` capability summary |
| IPC | Tauri typed commands and strict decoders |
| Scale strategy | Dependency-free pagination, exactly 50 items per page |

Adding a virtualization, fuzzy-search, or search-index dependency requires
separate approval.

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

Manual performance measurement uses a deterministic packaged/fixture corpus of
at least 500 entries and does not scan or modify the real home directory.

## Project Structure

```text
src/features/apps/ApplicationsPage.tsx       workspace composition
src/features/apps/ApplicationList.tsx        paged logical list
src/features/apps/ApplicationFilters.tsx     search/filter controls
src/features/apps/ApplicationDetails.tsx     source/support/detail projection
src/features/apps/catalogCoverage.ts         coverage calculations
src/app/selectionMemory.ts                    safe session selection
src/ipc/catalog.ts                            typed query/page decoding

src-tauri/src/catalog/                        corpus index and validation
src-tauri/src/commands/catalog.rs             bounded list/query commands
src-tauri/src/discovery/                      local detection snapshots
```

Application rows and detail views remain capability-driven and contain no
application-specific branches.

## Code Style

Use a fixed-size paged query contract:

```typescript
interface ApplicationQuery {
  query: string;
  category?: string;
  coverage?: ManagedAppCoverageClass;
  detected?: boolean;
  page: number;
  pageSize: 50;
}

interface ApplicationPage {
  items: readonly ManagedAppSummary[];
  page: number;
  pageSize: 50;
  totalItems: number;
  totalPages: number;
}
```

Keep selection independent from array position:

```typescript
const selectedApplication =
  page.items.find((application) => application.id === selectedAppId) ??
  page.items[0];
```

Conventions:

- Stable IDs, not indexes, own selection and React keys.
- Derived search/filter data uses memoized pure functions.
- Async requests use request identity or cancellation so stale responses cannot
  replace newer results.
- Decode counts, page number, fixed page size, strings, and enum values at the
  IPC boundary.
- Do not cache or log config contents in browsing state.

## Testing/Verification Strategy

- Reuse existing `ApplicationsPage.test.tsx`, catalog IPC tests, selection
  tests, and async-state tests for pagination, focus, and stale response
  behavior.
- Reuse Rust catalog tests for increased bounds, query validation, deterministic
  ordering, uniqueness, fixed page size, and malformed-corpus rejection.
- Reuse WDIO for keyboard navigation, page navigation, filter/search, selection
  persistence, detail/edit handoff, and fixed-window scroll containment.
- Measure search/filter response and mounted row count using a deterministic
  500-entry fixture/corpus; do not use live network or the real home directory.
- Manual accessibility acceptance verifies VoiceOver announcements for result
  count, selected item, page/range changes, loading, empty, and error states.
- New test files or performance tooling require explicit approval.

## Boundaries

### Always

- Keep runtime browsing offline and use only validated packaged corpus plus
  local detection metadata.
- Bound IPC payloads to 50 results, and bound string sizes and result counts.
- Preserve coverage class, source provenance, limitations, exclusions, and
  edit capability distinctions.
- Keep selection/focus stable across refresh, query, filters, and page changes.
- Delegate all config parsing and mutation to typed editing/config services.

### Ask first

- Add a virtualization, fuzzy-search, indexing, or worker dependency; add a new
  test file; change the fixed window; persist browsing history beyond current
  approved selection memory; or fetch catalog data at runtime.
- Change the fixed page size of 50 or raise catalog limits beyond measured needs
  without memory/payload review.

### Never

- Render all 500+ rows simultaneously.
- Treat missing/failed catalog data as an empty successful catalog.
- Expose raw filesystem paths, source tokens, config contents, or arbitrary
  source URLs through list rows.
- Add `appId` branches for presentation or editing.
- Allow browsing metadata, source provenance, or schema presence to grant write
  authority.

## Dependency Interfaces

### Consumes from `desktop-visual-consistency`

- Fixed viewport, compact row dimensions, list/detail geometry, semantic
  tokens, focus visibility, text accommodation, and pane-scroll ownership.

### Consumes from `open-source-config-sourcing`

```typescript
interface CorpusManifest {
  corpusVersion: number;
  entryCount: number;
  contentSha256: string;
  entries: readonly CatalogCorpusEntry[];
}
```

The runtime exposes a bounded query projection rather than transferring this
full array to the WebView.

### Consumes from `schema-driven-config-editing`

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

### Provides

```text
query_applications(query with pageSize = 50) -> ApplicationPage
get_application_detail(appId) -> ApplicationDetail
get_application_editing_capabilities(appId) -> ConfigEditingCapabilitySummary[]
```

All inputs are validated IDs, enums, bounded strings, page numbers, and the
fixed page size; no path input is accepted.

## Success Criteria

1. A valid offline corpus containing at least 500 applications loads without
   exceeding reviewed Rust/TypeScript bounds or producing an internal decoder
   error.
2. Search and filter updates complete within 100 ms at p95 on the baseline
   Apple Silicon Mac for 500 entries, measured over at least 50 representative
   queries after initial load.
3. Results are returned in pages of exactly 50 items, except for a shorter final
   page; no request or DOM result list contains more than 50 application rows.
4. Keyboard users can reach the first and last item on a page, move to previous
   and next pages, choose a direct page, and open detail without focus loss.
5. Query, filters, selection, page, scroll position, and selected document
   remain stable when returning from detail/editor and during unrelated async
   provider updates.
6. At 1120 by 720 and 200% text zoom, the document does not scroll horizontally
   or vertically; list and detail panes remain independently reachable.
7. Unsupported and excluded applications expose zero write controls, while
   managed applications show only the typed structured/raw/preset capabilities
   authorized by their document definitions.

## Open Questions

- The reviewed maximum catalog size above the required 500 entries should be
  set from corpus growth projections; 1,000 is a candidate bound, not yet an
  approved constant.
- Whether search remains a client-side normalized index or becomes a bounded
  Rust query command depends on measured IPC payload and startup cost.
