# Release process

UserHome separates untrusted pull request builds from protected tagged
releases. No workflow publishes a non-draft release.

## Pull requests

`.github/workflows/ci.yml` runs lint, type checking, frontend tests, Rust checks,
desktop E2E, and `pnpm build:unsigned`. The unsigned executable is uploaded as a
GitHub Actions artifact with seven-day retention. The workflow has only
`contents: read` and does not receive Apple release secrets.

## Tagged draft releases

`.github/workflows/release.yml` runs only for tags matching `v*` and targets the
protected `release` environment. Configure all of these encrypted secrets:

- `APPLE_CERTIFICATE`: base64 PKCS#12 Developer ID Application certificate.
- `APPLE_CERTIFICATE_PASSWORD`: PKCS#12 password.
- `APPLE_SIGNING_IDENTITY`: exact Developer ID Application identity.
- `APPLE_ID`: notarization Apple ID.
- `APPLE_PASSWORD`: app-specific password.
- `APPLE_TEAM_ID`: Apple Developer Team ID.

The workflow fails before certificate import if any value is empty. It then:

1. Runs the canonical project checks.
2. Builds the helper executable and bridge for `arm64` and `x86_64`, combines
   them with `lipo`, and signs both nested binaries.
3. Builds the Tauri universal app and DMG with hardened runtime signing and
   notarization inputs.
4. Verifies the app, helper, bridge, both helper architectures, and stapled
   notarization ticket.
5. Archives the app and creates a draft GitHub Release for the existing tag.

The workflow deliberately does not use `workflow_dispatch`, create a tag, or
publish the draft. Configure required reviewers for the `release` environment
and branch/tag protection in GitHub before production use.

## Local unsigned verification

```bash
pnpm build:helper:universal
pnpm build:unsigned
pnpm tauri build --target universal-apple-darwin
lipo -archs src-tauri/helper/dist/UserHomeHelper
lipo -archs src-tauri/helper/dist/libUserHomeHelperBridge.dylib
```

Expected helper output contains both `arm64` and `x86_64`. Unsigned output is
development evidence only and must not be uploaded to a public Release.

## Production verification gate

Before publishing a draft, verify the protected run itself:

- All checks and the universal build succeeded on GitHub-hosted macOS.
- `codesign --verify --deep --strict` succeeded for the app and separately for
  the nested helper and bridge.
- `xcrun stapler validate` succeeded.
- The downloaded DMG and app archive contain the expected version and both
  architectures.
- Gatekeeper launches the downloaded app on representative macOS 13+ Intel and
  Apple Silicon machines.
- Helper registration, denial, unregister, and disposable protected Caddy
  fixture checks in `docs/elevation-checklist.md` pass.

Rollback is to leave or return the GitHub Release to draft, remove affected
assets, and publish a new fixed tag after repeating the full gate. Do not reuse
or move an existing release tag.

Official references:

- https://v2.tauri.app/distribute/pipelines/github/
- https://v2.tauri.app/distribute/sign/macos/
- https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication
- https://docs.github.com/en/actions/using-workflows/storing-workflow-data-as-artifacts
