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

## T58 editor and terminal comparison

The T58 catalog batch was compared with the same approved root mapping using
existence-only checks. No file content or absolute private path was printed.
`Present` means the exact catalog document existed in the local baseline;
`Absent` remains useful catalog coverage and does not trigger broader
discovery.

| Application | Safe catalog documents | Baseline evidence |
|---|---|---|
| Visual Studio Code | `APPLICATION_SUPPORT/Code/User/settings.json`; `APPLICATION_SUPPORT/Code - Insiders/User/settings.json` | Both channels present |
| Cursor | `APPLICATION_SUPPORT/Cursor/User/settings.json` | Absent |
| Zed | `XDG_CONFIG_HOME/zed/settings.json` | Present |
| Vim | `HOME/.vimrc`; `HOME/.vim/vimrc` | Primary present; runtime document absent |
| Neovim | `XDG_CONFIG_HOME/nvim/init.lua`; `XDG_CONFIG_HOME/nvim/init.vim` | Both entry points absent |
| Ghostty | `APPLICATION_SUPPORT/com.mitchellh.ghostty/config`; `XDG_CONFIG_HOME/ghostty/config` | XDG document present; macOS document absent |
| iTerm2 | `HOME/Library/Preferences/com.googlecode.iterm2.plist` | Present |
| tmux | `HOME/.tmux.conf`; `XDG_CONFIG_HOME/tmux/tmux.conf` | Both documents absent |
| Starship | `XDG_CONFIG_HOME/starship.toml` | Present |

Stable and Insiders VS Code settings share one application identity because
their JSON settings semantics match, but they remain distinct documents.
Cursor stays a separate product identity. Vim and Neovim also remain separate;
Neovim's Lua and Vimscript entry points are not modeled as variants because
their languages are not interchangeable. Missing paths, project-local files,
custom iTerm2 preference folders, and recursive plugin/runtime trees are not
inferred or scanned.

## Handling exported data

Use the IPC result directly for local catalog analysis. If a temporary JSON
artifact is required, write it outside the repository (for example under the
system temporary directory or the Orca session artifact directory), inspect it
locally, and delete it when finished. Do not add raw or generated baseline
manifests to version control; this document records only aggregate,
non-identifying evidence.
