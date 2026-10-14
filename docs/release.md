# Release process

**用途：**发布维护者的操作指南，说明 CI、标签构建、签名、公证、草稿发布与回滚。
随工作流和构建命令变化更新；实际运行证据和是否允许生产发布的结论见
[release-readiness.md](release-readiness.md)，不能从流程已配置推断门禁已通过。

UserHome separates untrusted pull request builds from protected tagged
releases. No workflow publishes a non-draft release.

## Pull requests

`.github/workflows/ci.yml` runs for pull requests and manual dispatch. It runs
lint, type checking, frontend tests, Rust checks, desktop E2E, and
`pnpm build:unsigned`. Only pull request runs upload the unsigned executable as
a GitHub Actions artifact with seven-day retention. The workflow has only
`contents: read`, does not receive Apple release secrets, and never creates a
GitHub Release.

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
pnpm lint
pnpm typecheck
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
pnpm test:e2e
pnpm build:unsigned
rustup target add aarch64-apple-darwin x86_64-apple-darwin
CI=true CARGO="$(rustup which cargo)" RUSTC="$(rustup which rustc)" \
  pnpm tauri build --target universal-apple-darwin
lipo -archs src-tauri/helper/dist/UserHomeHelper
lipo -archs src-tauri/helper/dist/libUserHomeHelperBridge.dylib
lipo -archs \
  src-tauri/target/universal-apple-darwin/release/bundle/macos/UserHome.app/Contents/MacOS/userhome
```

Use the repository-pinned Node.js and pnpm versions. On machines where Homebrew
`cargo` precedes rustup in `PATH`, the explicit `CARGO` and `RUSTC` values above
ensure the installed cross-target standard libraries are used. `CI=true` keeps
DMG creation non-interactive and avoids Finder automation.

Expected architecture output contains both `arm64` and `x86_64` for the app,
helper, and bridge. Local output is unsigned or ad-hoc signed development
evidence only: it does not prove a Developer ID identity, Team ID,
notarization, stapling, Gatekeeper acceptance, or the protected GitHub release
path, and it must not be uploaded to a public Release.

当前自动化桌面冒烟检查初始 1120 × 720 逻辑尺寸、可调整尺寸但禁止最大化、
扩大至 1360 × 960 后恢复及无文档级溢出、路由焦点规则、624 项应用目录的
首个 50 项分页（共 13 页）、Homebrew 加载结束、刷新合并，以及未签名 helper
失败关闭。具体断言以 `e2e/smoke.spec.ts` 为准，不代表逐一验收全部目录条目。
运行时使用隔离的临时 `HOME`/`XDG_CONFIG_HOME`，不检查真实用户配置。
冒烟不能替代窗口拖动、原生边框缩放与最小尺寸约束、最小化/关闭/重开、
显示缩放、完整键盘流程、VoiceOver、对比度、减少动态效果、app/Dock/Finder
图标或亮暗模式托盘外观及交互的人工验收。

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
- helper 注册、拒绝、注销及一次性受保护 Caddy 夹具检查通过
  [elevation-checklist.md](elevation-checklist.md) 的人工清单。
- 初始及最小 1120 × 720 尺寸、原生边框缩放、禁止最大化/全屏、内部滚动、
  纯键盘流程、VoiceOver、对比度、减少动态效果、app/Dock/Finder 图标及托盘行为，
  均在支持的显示缩放和亮暗外观下完成人工验收。

Rollback is to leave or return the GitHub Release to draft, remove affected
assets, and publish a new fixed tag after repeating the full gate. Do not reuse
or move an existing release tag.

Official references:

- https://v2.tauri.app/distribute/pipelines/github/
- https://v2.tauri.app/distribute/sign/macos/
- https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication
- https://docs.github.com/en/actions/using-workflows/storing-workflow-data-as-artifacts
