# Threat model

## Controlled-elevation trust boundary

### Assets

- Root-owned Caddy configuration and system LaunchDaemon state.
- The user's explicit preview/confirmation decision.
- Operation history and sanitized helper audit records.
- The signing relationship between `com.zephyr194.userhome` and
  `com.zephyr194.userhome.helper`.

### Trust boundaries

1. Frontend values are untrusted until the Rust command validates the catalog
   resource, operation intent, action enum, hashes, and expiring preview.
2. The Rust process sends a versioned request from the main app process through
   the bundled in-process Swift bridge. The bridge connects with
   `XPC_CONNECTION_MACH_SERVICE_PRIVILEGED`.
3. The root LaunchDaemon obtains the XPC connection audit token and accepts only
   the expected signed main-app identifier and Team ID.
4. Payload bytes are separate from request metadata and must match
   `payloadHash`; no path, executable, argument list, environment, or shell text
   crosses the boundary.
5. The helper maps the two catalog resource IDs to compiled Caddy targets and
   enum actions. Filesystem targets and ancestors must be root-owned,
   non-symlink, and not group/world writable.

### STRIDE controls and abuse cases

| Threat | Abuse case | Control |
|---|---|---|
| Spoofing | A local process registers a same-name user Mach service. | The bridge uses the privileged bootstrap namespace; the daemon validates the main app audit token, bundle identifier, and Team ID. |
| Tampering | A request changes action/resource IDs or payload bytes after preview. | Rust revalidates the pending intent; Rust and Swift validate the versioned allowlist and hashes; the response echoes bound fields and a canonical digest. |
| Repudiation | A privileged action is later denied or its result is ambiguous. | The helper writes bounded metadata only: audit ID, operation/resource/action IDs, request digest, result, and completion time. Audit-write failure returns partial failure. |
| Information disclosure | Configuration content or filesystem paths leak into protocol logs. | The serialized request has a fixed field set with IDs/hashes/timestamps only; audit records omit content and paths. |
| Denial of service | A helper operation hangs after the UI times out. | Requests carry a maximum 12-second deadline; the helper rechecks it before replacement and terminates timed-out child processes. |
| Elevation of privilege | A user invokes a bundled proxy directly or replaces Homebrew Caddy with malicious code. | No standalone stdin-to-XPC request proxy exists, and the root helper never runs Homebrew-managed binaries. Root-controlled path-chain checks precede mutation. |

### Failure behavior

- Unknown protocol versions, resources, actions, fields, hashes, stale
  confirmations, expired deadlines, replayed request IDs, and mismatched
  responses fail closed.
- Missing signing, helper registration, or System Settings approval reports
  unavailable.
- Denial, disconnect, timeout, invalid response, and partial failure retain
  distinct application error codes.
- A service action is successful only after the application refreshes inventory
  and observes the requested state.
- Automated tests never register a daemon or mutate a protected path/service.

### Residual and external risks

- Signed-path acceptance requires an Apple Developer signing identity and a
  disposable root-owned Caddy fixture. This workstation reports
  `0 valid identities found`, so registration, denial, unregister, and live
  protected mutation remain externally blocked.
- The final release workflow must sign the helper executable and bridge before
  signing/notarizing the containing app, preserving identifiers and Team ID.
- A timeout is safe because the helper enforces the same deadline. If a future
  action becomes irreversible before its final deadline check, it must add
  persistent result lookup and idempotent recovery before release.

## Distribution trust boundary

### Controls

- Pull request workflows have `contents: read`, receive no release secrets, and
  upload only short-lived GitHub Actions artifacts. They cannot create a
  GitHub Release.
- The release workflow is tag-only, uses a protected `release` environment, and
  grants only `contents: write`. It exits before certificate import when any
  required signing or notarization secret is absent.
- The helper executable and bridge are built for both `arm64` and `x86_64`,
  combined with `lipo`, and signed before the containing app is built.
- The workflow verifies the nested helper, bridge, containing app, both helper
  architectures, and the stapled notarization ticket before creating a draft
  release.
- The workflow creates a draft only. Publishing remains an explicit human
  decision after reviewing artifacts and the release-readiness evidence.

### Residual risks and required controls

- GitHub environment protection, repository branch protection, allowed Actions,
  and encrypted secrets are external repository settings and cannot be proven
  from this worktree.
- A malicious or compromised third-party Action tag could change over time.
  The current workflows use established major-version tags; repository policy
  should pin actions to reviewed commit SHAs before the first production
  release if immutable action provenance is required.
- Notarization and Gatekeeper acceptance require Apple services and a real
  Developer ID identity. Local unsigned builds cannot substitute for that
  evidence.

### Authoritative platform references

- Apple `SMAppService`: https://developer.apple.com/documentation/servicemanagement/smappservice
- Apple `SMAppService.daemon(plistName:)`: https://developer.apple.com/documentation/servicemanagement/smappservice/daemon(plistname:)
- Apple `SMAppService.register()`: https://developer.apple.com/documentation/servicemanagement/smappservice/register()
- Apple `SecCodeCopyGuestWithAttributes`: https://developer.apple.com/documentation/security/seccodecopyguestwithattributes(_:_:_:_:)
- Tauri bundled resources: https://v2.tauri.app/develop/resources/
- Tauri macOS application bundles: https://v2.tauri.app/distribute/macos-application-bundle/
- Tauri GitHub pipelines: https://v2.tauri.app/distribute/pipelines/github/
- Tauri macOS signing: https://v2.tauri.app/distribute/sign/macos/
- GitHub `GITHUB_TOKEN` permissions: https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication
