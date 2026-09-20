# Signed helper verification checklist

Automated CI uses the fake elevation transport and must not mutate live
configuration or services. Run this checklist only on a disposable macOS 13+
machine with development signing credentials.

## Build and signing

- [ ] Build `UserHomeHelper` and `libUserHomeHelperBridge.dylib`.
- [ ] Sign the helper as `com.zephyr194.userhome.helper`.
- [ ] Sign the bridge and then the containing app as
      `com.zephyr194.userhome` with the same Team ID.
- [ ] Verify all three artifacts with `codesign --verify --strict --verbose=4`.
- [ ] Confirm `Contents/Library/LaunchDaemons/com.zephyr194.userhome.helper.plist`
      and `Contents/Resources/UserHomeHelper` are present.

## Registration states

- [ ] Before registration, status is `NOT_REGISTERED` and `available=false`.
- [ ] Register through the app and confirm System Settings approval is required.
- [ ] Deny approval and confirm the app remains unavailable/fail-closed.
- [ ] Approve registration and confirm status is `ENABLED`.
- [ ] Unregister through the app and confirm status returns to `NOT_REGISTERED`.

## Protected disposable fixture

- [ ] Create only the approved Caddy fixture at an allowlisted path whose target
      and full ancestor chain are root-owned, non-symlink, and not group/world
      writable.
- [ ] Verify stale current hashes, modified payload bytes, wrong operation IDs,
      wrong resource/action pairs, replayed request IDs, and expired deadlines
      are denied without mutation.
- [ ] Verify one confirmed write succeeds, preserves mode, and produces a
      sanitized audit record without content or path data.
- [ ] Verify Caddy system start/stop/restart use only fixed `launchctl` mappings,
      and refreshed state is required before the app reports success.
- [ ] Simulate denial, XPC disconnect, timeout, and audit-write failure; confirm
      explicit safe outcomes and no success-shaped fallback.

## Current blocker

`security find-identity -v -p codesigning` returned `0 valid identities found`
on 2026-09-20. The signed-path checklist is therefore intentionally incomplete;
unsigned build and fake-transport evidence cannot substitute for it.
