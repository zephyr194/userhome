# Managed application catalog extension

`src-tauri/src/catalog/catalog-v1.json` is the authorization source of truth.
Discovery evidence never grants write or execution authority by itself.

## Adding an application

1. Add a unique, stable `id`, `displayName`, description, and `iconKey`.
2. Add only bounded detection rules:
   - `HOME_PATH` must remain below the current user's home.
   - `HOMEBREW_PATH` must remain below `/opt/homebrew` or `/usr/local`.
   - `EXECUTABLE`, `BREW_FORMULA`, and `SERVICE` values are identifiers, not
     paths or command fragments.
3. Declare only executable/package/service identifiers already implemented by
   typed Rust enums. A catalog entry must not introduce arbitrary commands,
   arguments, environments, launchd labels, or paths.
4. For every `configDocument`, define a unique `configId`, approved
   `pathTemplate`, known `format`, `sensitivity`, `adapterId`, `validatorId`,
   finite `maxSizeBytes`, and least-privilege `writePolicy`.
5. Mark credentials, tokens, endpoints containing credentials, and similar
   content as `SECRET`; mark identity and host configuration as `SENSITIVE`.
6. Add or reuse a parser and validator before enabling writes. A new parser,
   validator, writable path, executable mapping, service mutation, or
   `elevationResourceId` requires explicit security review and approval.
7. Add fixture-based catalog, discovery, read, validation, diff, backup, write,
   restore, and redaction coverage as applicable. Fixtures must use temporary
   homes and must not read live user files.

## Compatibility rules

- Increment `schemaVersion` only for additive schema changes.
- Never repurpose an existing app, config, adapter, validator, service, or
  elevation resource ID.
- Unknown fields and unsafe definitions must fail catalog validation.
- Unknown dot-directories remain metadata-only and read-only.
- Apple Silicon and Intel Homebrew prefixes must remain explicit and bounded.
- Frontend IPC continues to send catalog IDs only; it never sends filesystem or
  executable paths.

## Review checklist

- [ ] IDs are unique and stable.
- [ ] Paths resolve under an approved root and symlink escape is rejected.
- [ ] File size and output limits are finite.
- [ ] Sensitivity and redaction behavior are documented.
- [ ] Write policy is no broader than required.
- [ ] Parser and validator reject malformed input before replacement.
- [ ] Any service or elevated action maps to a compiled allowlist.
- [ ] Tests use temporary fixtures and leave live configuration untouched.
