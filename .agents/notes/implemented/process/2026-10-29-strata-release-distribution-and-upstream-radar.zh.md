# Agent Note: StrataHarness 发布分发、签名模式与上游发布雷达

Status: implemented

[English](2026-10-29-strata-release-distribution-and-upstream-radar.md) | 中文

## 问题

上游 DeepSeek Harness 在内部运行器上打包桌面目标平台，在 `apps/desktop/scripts/windows-sign.mjs` 中仅支持通过物理 SafeNet 硬件令牌对 Windows 二进制文件签名，在未签名 macOS 构建中仅输出 `.dmg`（不含 `.zip`），并将安装包与 `electron-updater` 更新源发布至腾讯云 COS（`download.deepseek.com` 下的 `dsh-desk/<target>/`）。

StrataHarness Desktop 需要在标准 GitHub 托管运行器（`windows-2022`、用于 `mac-arm64` 的 Apple Silicon `macos-15` 以及用于 `mac-x64` 的原生 Intel `macos-15-intel`）上提供完全自治的分发流水线，彻底消除对腾讯云 COS 或 `*.deepseek.com` 的依赖，在配置付费代码签名证书之前开箱即用地输出 `unsigned` 安装包，在添加密钥后无缝启用标准云端 CI 证书签名，并在上游 DeepSeek Harness 发布新 `dsh-v*` 标签时为系统架构师提供主动感知能力，同时绝不在终端用户桌面客户端内暴露任何上游遥测或更新提示。

## 决策

StrataHarness 提供由模块化 GitHub Actions 工作流（`strata-windows-package.yml`、`strata-macos-package.yml` 以及由 `strata-v*` 标签和 `workflow_dispatch` 触发的 `strata-release.yml`）驱动的双层分发流水线：

1. **签名模式（`auto` / `unsigned` / `signed`）：** `apps/desktop/scripts/strata-signing-mode.mjs` 在 `auto` 模式下检测平台签名密钥，在未配置密钥时干净回退至 `unsigned`（输出带 `-unsigned` 后缀的产物、设置 `publish: null`，并在 macOS 上同时输出 `.dmg` 与 `.zip`，在 Windows 上输出 `.exe`）；显式指定 `signed` 时若缺少必要密钥则在预检阶段快速失败。在 Windows 上，`apps/desktop/scripts/windows-sign.mjs` 在保留本地 SafeNet 硬件令牌支持的同时支持标准 Base64/文件 `.pfx` 证书（`WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD`）以及 RFC-3161 时间戳回退链（`DigiCert` → `Sectigo` → `GlobalSign`），所有临时凭据文件仅在 `RUNNER_TEMP` 中落地并配合日志脱敏与 `if: always()` 强制清理。当未配置 `DOWNLOAD_PROD_ORIGIN` 时，`signed` 构建会省略 `app-update.yml` 发布配置（`publish: null`），以便在启用独立更新 CDN 前先通过 GitHub Releases 分发已签名安装包。
2. **原子化 GitHub Releases 与通用 HTTPS 更新源：** 平台构建矩阵启用 `fail-fast: false` 以完整保留诊断产物，同时 `strata-release.yml` 与 `scripts/strata/release-helper.ts` 在发布正式 GitHub Release（含 `.exe`、`.dmg`、`.zip`、`SHA256SUMS.txt` 与自动生成的发布说明）或同步 `electron-updater` 通用 HTTPS 更新源（`${DOWNLOAD_PROD_ORIGIN}/strataharness/feeds/<target>/`，本地通过 [桌面本地更新器资格验证](../testing/2026-09-10-desktop-local-updater-qualification.zh.md) 校验，并在配置 `STRATA_S3_*` 密钥时通过 AWS CLI 分两轮自动同步）之前，强制要求全部三个目标平台（`win-x64`、`mac-arm64`、`mac-x64`）均构建成功。仅允许在手动触发 `draft` 或 `prerelease` 时选择部分目标平台。
3. **仅面向架构师的上游发布雷达（`strata-upstream-watch.yml` + `pnpm run strata:check-upstream`）：** GitHub Actions 按每日定时任务轮询 `https://github.com/deepseek-ai/deepseek-harness.git`（绝不在客户端运行时中执行），将 `dsh-v*` 标签与 `strata-product.json` 中的 `upstreamBaseTag` 对比，幂等地创建或更新单个带 `strata:upstream-radar` 标签的去重 GitHub Issue（并支持可选的 `STRATA_ARCHITECT_WEBHOOK_URL` 推送通知），汇总新增的 `docs/upgrade-guide/` 条目以及与 `strata(override)` 提交重叠的变更文件。

## 曾考虑的替代方案

**直接使用 `electron-updater` 的 `provider: github` 对接 GitHub Releases，放弃通用 HTTPS 更新源契约。** 虽然对公开仓库较为简便，但 `provider: github` 会将客户端更新检查与 GitHub API 速率限制及仓库可见性深度耦合，并偏离 `test:updates:local` 所验证的通用更新源目录契约。保留 `DOWNLOAD_PROD_ORIGIN/strataharness/feeds/<target>/` 下的 `provider: generic` 并配合 GitHub Releases，可无厂商锁定地对接任意静态 CDN、S3、Cloudflare R2 或 GitHub Pages。

**当某个平台运行器失败时允许发布不完整的正式版本。** 发布缺失 `win-x64` 或 `mac-arm64` 的正式 `strata-v*` 版本会导致用户遇到损坏的下载链接，并将同一产品版本号割裂为不一致的发布状态。在 Actions 中保留已成功平台的构建产物、同时对正式发布实施三平台原子门禁，既能保住已完成的构建成果，又能避免暴露残缺版本。

**在 StrataHarness Desktop 客户端内部检查上游 `dsh-v*` 新版本。** 终端用户使用的是零上游后台请求的独立产品；上游同步需要系统架构师进行代码评审、`strata(override)` 冲突评估与重新打包，因此 GitHub Actions 与 `fork-ops.ts` 才是恰当的执行边界。

**在 Apple Silicon `macos-15` 运行器上通过 Rosetta 2 构建并对 `mac-x64` 执行冒烟测试。** 尽管本地打包支持在 Apple Silicon 上交叉构建 `mac-x64`，但在 3 核 `macos-15` 运行器上通过 Rosetta 2 即时转译冷启动内置 `x86_64` LibreOffice 执行 `smokeDesktopRuntime` 的 `docx` 转换时，会超出 `OfficeToPdf` 的 60 秒超时上限。将 `mac-x64` 路由至原生 `macos-15-intel` 并在前置检查中同时校验 `uname -m` 与 `sysctl.proc_translated`，即可在不放宽应用运行时超时阈值的前提下原生完成打包与冒烟验证。

## 后果

- `strata-windows-package.yml`（`win-x64`）与 `strata-macos-package.yml`（`mac-arm64`、`mac-x64`）同时支持 `workflow_dispatch` 与 `workflow_call`，递归检出 `resources/strataharness` 子模块，在无密钥的 `auto` 模式下自动回退为 `unsigned`，并输出通过 `check:package` 的 `.exe`、`.dmg` 与 `.zip` 产物。
- `windows-sign.mjs` 在硬件令牌签名之外支持 `.pfx` 签名（`WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`）与 RFC-3161 时间戳重试；`desktop-auto-update-environment.mjs` 与 `desktop-upload-plan.ts` 在 `DOWNLOAD_PROD_ORIGIN` 下生成 `strataharness/feeds/<target>/` 路径，并拒绝 `download.deepseek.com` 及 `*.deepseek.com` 域名。
- `strata-release.yml` 校验 `strata-v*` 标签与 `strata-product.json` 的一致性，对正式发布强制执行三平台原子门禁，生成 `SHA256SUMS.txt` 与标注引擎基线的发布说明，并在隔离的 StrataHarness 标识（`com.nikl.strataharness`、`@strata/desktop`、`.strataharness`）下通过本地 `test:updates:local` 资格验证。
- `strata-upstream-watch.yml` 与 `pnpm run strata:check-upstream` 能够生成对比新 `dsh-v*` 标签与 `upstreamBaseTag`、`docs/upgrade-guide/` 及 `strata(override)` 文件的影响评估报告，且不触碰任何客户端运行时包。

在配置 Apple Developer ID 签名与公证密钥之前，未签名的 macOS `.dmg` 与 `.zip` 构建会在终端用户设备上触发 Gatekeeper 隔离提示，且未签名构建会有意省略 `electron-updater` 的 `latest*.yml` 元数据，以防止未经签名校验的二进制包被静默自动安装；自动生成的发布说明与 `docs/strata/fork-maintenance.md` 均明确记录了首次启动的 Gatekeeper 和 SmartScreen 放行指引，以及通过配置仓库密钥零代码切换至 `signed` 模式的流程。
