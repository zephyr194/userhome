# Home Baseline Coverage

The developer-facing `export_sanitized_baseline` command returns a bounded,
content-free manifest for catalog planning. The TypeScript wrapper is
`exportSanitizedBaseline()` in `src/ipc/discovery.ts`.

## Coverage contract

The manifest uses schema version `1` and contains:

- Completeness and bounded scan statistics.
- Total, managed, unsupported, excluded, exported, and omitted counts.
- Stable candidate IDs, typed root aliases, normalized relative paths, entry
  types, classification evidence, format hints, sensitivity hints, coverage,
  reasons, and optional catalog ownership.

The following equations must always hold:

```text
managed = managedWritable + managedReadOnly
total = managed + unsupported + excluded
total = exported + omitted
```

Exported rows omit modification times, legacy display names, scan issue text,
`SECRET` candidates, and `EXCLUDED` candidates. Excluded counts still
participate in the coverage totals, so caches, logs, databases, sockets,
credential stores, and runtime state remain accounted for without exposing
their paths.

## Baseline root check

The approved roots were counted without printing entry names or reading file
contents on 2026-09-21:

| Root alias | Direct entries | Limit |
|---|---:|---:|
| `HOME` | 93 | 128 |
| `XDG_CONFIG_HOME` | 11 | 128 |
| `APPLICATION_SUPPORT` | 128 | 128 |
| `HOMEBREW_PREFIX` (primary `etc`) | 16 | 128 |
| `HOMEBREW_PREFIX` (secondary `etc`) | 1 | 128 |

The count-only check completed in 1 ms against the 1.5 second scanner budget.
Candidate discovery also enforces a global limit of 128 candidates, 512
metadata operations, and one enumerated level.

The sanitized runtime export reported:

| Metric | Count |
|---|---:|
| Total | 128 |
| Managed | 15 |
| Unsupported | 110 |
| Excluded | 3 |
| Exported rows | 119 |
| Omitted rows | 9 |

The export inspected three roots and 159 metadata records in 9 ms. Its
completeness was `PARTIAL` because the global candidate limit was reached; the
coverage equations still balanced and every exported path passed the alias and
privacy checks. The raw JSON was streamed through the validator and was not
written to disk.

## Handling exported data

Use the IPC result directly for local catalog analysis. If a temporary JSON
artifact is required, write it outside the repository (for example under the
system temporary directory or the Orca session artifact directory), inspect it
locally, and delete it when finished. Do not add raw or generated baseline
manifests to version control; this document records only aggregate,
non-identifying evidence.
