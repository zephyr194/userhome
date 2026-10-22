# Threat model

**用途：**记录只读配置、受控提权和发布分发的信任边界、失败策略与残余风险，供实现和安全审查使用。
权限、数据流或分发边界变化时更新；本文不是已完成安全验收的证明，实际结果与外部阻塞
见 [release-readiness.md](release-readiness.md)。

## 新只读配置入口

新 `ApplicationProfile` 与旧 Catalog 写入授权分离，只有内置 HOME 相对根及明确核心资源。
客户端仅提交应用/资源 ID；清单不读取正文，每次读取重检资源集合、排除与规范化根。
`settings.json` 只投影声明字段，未知值和注释不返回；`config.json` 分支不打开正文。
指令有大小、深度、数量和时间上限，不执行或渲染原始 HTML。

内置及用户排除按路径组件匹配；排除存储损坏、未知版本、权限或链接异常时失败关闭，
不退回空名单。新排除设置不撤销旧后端权限，当前只读入口不提供旧变更操作。
原权限边界仍成立。路径规范化、逐次复检与有界读取不是对恶意本地
文件系统竞态的完整隔离证明。

## Controlled-elevation trust boundary（已移除）

提权 helper、LaunchDaemon 与 Swift bridge 已于 2026-10-22 从应用中移除（G3-9）。
当前应用没有 root 提权通道，Homebrew、配置与服务操作均以当前用户权限执行，因此不存在
该边界的运行时控制。若将来重新引入提权，必须先建立新的资产清单、信任边界与 STRIDE 分析，
不得沿用被移除设计的假设。

## Distribution trust boundary

### Controls

- Pull request workflows have `contents: read`, receive no release secrets, and
  upload only short-lived GitHub Actions artifacts. They cannot create a
  GitHub Release.
- The release workflow is tag-only, uses a protected `release` environment, and
  grants only `contents: write`. It exits before certificate import when any
  required signing or notarization secret is absent.
- The workflow verifies the containing app's deep code signature and the stapled
  notarization ticket before creating a draft release.
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

- Tauri bundled resources: https://v2.tauri.app/develop/resources/
- Tauri macOS application bundles: https://v2.tauri.app/distribute/macos-application-bundle/
- Tauri GitHub pipelines: https://v2.tauri.app/distribute/pipelines/github/
- Tauri macOS signing: https://v2.tauri.app/distribute/sign/macos/
- GitHub `GITHUB_TOKEN` permissions: https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication
