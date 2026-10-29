# Agent Note: StrataHarness Desktop 双轨产品版本管理

Status: implemented

[English](2026-10-29-strata-dual-track-product-versioning.md) | 中文

## 问题

StrataHarness Desktop 作为基于 DeepSeek Harness 上游 `dsh-v*` 发布标签的 Soft-Fork 进行维护。上游工作区约束检查（`scripts/check-workspace-constraints.ts` 中的 `checkDshFamilyVersion`）以及 [npm 发布序列](../process/2026-08-10-npm-release-sequences.zh.md) 中的发布规则要求根 `package.json` 与所有 `@deepseek-ai/dsh` 及 `@deepseek-ai/dsh-*` 包清单保持完全一致的引擎版本字符串（例如 `0.2.1-rc.4`）。

与此同时，StrataHarness 拥有从 `1.0.0` 起步的独立桌面产品生命周期：功能发布与上游同步递增 `MINOR`（`1.1.0`、`1.2.0`），缺陷修复与方法论技能更新递增 `PATCH`（`1.1.1`），重大里程碑递增 `MAJOR`（`2.0.0`）。若将一百多个 `@deepseek-ai/dsh-*` 清单中的 `version` 改写为 `1.0.0`，每次执行 `git merge dsh-v*` 都会触发全仓范围的合并冲突；反之，若直接将 `0.2.1-rc.4` 用作 Electron 产品版本，则会在 `StrataHarness` 安装包、`electron-updater` 更新源与 Web UI 版本展示中暴露上游候选发布版本号，并导致无法在同一上游标签基础上连续发布多个 StrataHarness 更新版本。

## 决策

根产品清单 `strata-product.json`（包含 `productName`、`productVersion`、`upstreamBaseTag`、`upstreamRepository`）作为 StrataHarness 产品 SemVer（`1.0.0+`）的唯一事实来源，同时根 `package.json`、`apps/desktop/package.json` 以及所有 `@deepseek-ai/dsh-*` 工作区清单保持上游引擎版本不变。

`pnpm run strata:version`（`scripts/strata/fork-ops.ts`）在 `strata-product.json` 与不受 `@deepseek-ai/dsh-*` 家族版本检查限制的 `@strata/*` 工作区包（`packages/strata/*/package.json`）之间原子化同步 `productVersion`。`apps/desktop/scripts/strata-desktop-config.mjs` 与 `apps/desktop/scripts/electron-builder-config.mjs` 通过 `extraMetadata.version` 注入 `productVersion`（用于控制打包后的 `app.getVersion()`、安装包文件名 `strataharness-<productVersion>-<os>-<arch>.*`、`electron-updater` 更新源版本比较以及 `strata-v<productVersion>` 发布标签一致性校验），`scripts/client-build-environment.ts` 将 `DSH_CLIENT_VERSION` 解析为 `productVersion`；同时 `app.asar/dsh/desktop-runtime.json` 保留内置引擎版本（`readDesktopRuntime(dsh).release.version`，参见 [Electron 桌面打包与更新](2026-08-25-electron-desktop-packaging-and-updates.zh.md)），且 `About StrataHarness`、GitHub Release Notes 与 `pnpm run strata:status` 额外展示 `Engine: DSH <dshEngineVersion>` 参考行。

## 曾考虑的替代方案

**将根 `package.json` 与所有 `@deepseek-ai/dsh-*` 清单改写为 `1.0.0`。** 这种方式虽然统一了所有 `package.json` 版本字段，但会在每次合并上游 `dsh-v*` 时造成一百多个工作区清单的合并冲突，并掩盖 `app.asar/dsh` 内实际打包的上游引擎版本。

**采用带上游前缀的复合版本号（例如 `0.2.1-strata.1` 或 `0.2.1+strata.1`）。** 根据 SemVer 规范，`electron-updater` 在比较版本优先级时会忽略构建元数据（`+strata.1`），导致基于同一上游基线的连续 StrataHarness 构建无法触发自动更新；而预发布后缀（`-strata.1`）会将稳定的 StrataHarness 生产版本永久标记为 `0.2.1` 的预发布版。

**仅在 `apps/desktop/package.json` 中存储 `productVersion`。** `scripts/check-workspace-constraints.ts` 与 `apps/desktop/scripts/prepare-dsh.ts` 会校验 `apps/desktop/package.json` 与 `@deepseek-ai/dsh` 家族版本的一致性；单独修改 `apps/desktop/package.json` 需要削弱上游工作区约束，不如在打包层通过 `extraMetadata.version` 注入清晰可靠。

## 后果

- `strata-product.json` 声明 `productVersion: "1.0.0"` 与 `upstreamBaseTag: "dsh-v0.2.1-rc.4"`，并与所有 `packages/strata/*/package.json` 清单一致；根 `package.json` 与 `@deepseek-ai/dsh-*` 清单保持上游引擎版本并通过 `pnpm run constraints`，在执行 `git merge dsh-v*` 时不会产生版本号合并冲突。
- `electron-builder` 配置、打包后的 `app.getVersion()`、安装包产物名称、`electron-updater` 元数据与 `DSH_CLIENT_VERSION` 均解析为 `productVersion`，而 `app.asar/dsh/desktop-runtime.json` 保留内置引擎版本并通过 `afterPack` 与 `check:package`。
- `About StrataHarness`、自动生成的 GitHub Release Notes 与 `pnpm run strata:status` 同时展示 StrataHarness 产品版本与基线 `DSH` 引擎版本。
- `pnpm run strata:version` 原子化更新 `strata-product.json` 与 `packages/strata/*/package.json`，且 `scripts/strata/release-helper.ts`（`preflight`）与 `pnpm run strata:audit-overrides` 会拒绝 `strata-v*` Git 标签、`strata-product.json` 与 `@strata/*` 清单之间的任何不一致。

任何将 `app.getVersion()` 与 `desktop-runtime.json` 内置 `dsh` 引擎版本混为一谈的代码在双轨分离下都会失败；`check:package` 负责校验打包后的 `desktop-runtime.json` 与内置 CLI，`test:updates:local` 则在 `@strata/desktop` 标识下验证 `electron-updater` 的产品版本升级路径（`1.0.0` 至 `1.0.1`）。
