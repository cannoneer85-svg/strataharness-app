# Agent Note: Dual-track product versioning for StrataHarness Desktop

Status: implemented

English | [中文](2026-10-29-strata-dual-track-product-versioning.zh.md)

## Problem

StrataHarness Desktop is maintained as a Soft-Fork over upstream `dsh-v*` release tags of DeepSeek Harness. The upstream workspace constraint check (`checkDshFamilyVersion` in `scripts/check-workspace-constraints.ts`) and the npm release rules in [npm release sequences](../process/2026-08-10-npm-release-sequences.md) require the root `package.json` and every `@deepseek-ai/dsh` and `@deepseek-ai/dsh-*` package manifest to carry the exact same engine version string (for example, `0.2.1-rc.4`).

At the same time, StrataHarness ships its own desktop product lifecycle starting at `1.0.0`, where feature releases and upstream synchronizations increment `MINOR` (`1.1.0`, `1.2.0`), fixes and methodology skill updates increment `PATCH` (`1.1.1`), and major milestones increment `MAJOR` (`2.0.0`). Rewriting `version` across more than one hundred `@deepseek-ai/dsh-*` manifests to `1.0.0` would trigger repository-wide merge conflicts on every `git merge dsh-v*`, while keeping `0.2.1-rc.4` as the Electron product version would expose upstream release-candidate numbers in `StrataHarness` installers, `electron-updater` feeds, and Web UI version displays, and would prevent shipping multiple StrataHarness updates on top of the same upstream tag.

## Decision

A root product manifest `strata-product.json` (`productName`, `productVersion`, `upstreamBaseTag`, `upstreamRepository`) serves as the single source of truth for StrataHarness product SemVer (`1.0.0+`), while root `package.json`, `apps/desktop/package.json`, and all `@deepseek-ai/dsh-*` workspace manifests retain the upstream engine version unchanged.

`pnpm run strata:version` (`scripts/strata/fork-ops.ts`) synchronizes `productVersion` atomically across `strata-product.json` and `@strata/*` workspace packages (`packages/strata/*/package.json`), which lie outside the `@deepseek-ai/dsh-*` family check. `apps/desktop/scripts/strata-desktop-config.mjs` and `apps/desktop/scripts/electron-builder-config.mjs` inject `productVersion` via `extraMetadata.version` (controlling packaged `app.getVersion()`, installer filenames `strataharness-<productVersion>-<os>-<arch>.*`, `electron-updater` feed comparison, and release tag parity `strata-v<productVersion>`), and `scripts/client-build-environment.ts` resolves `DSH_CLIENT_VERSION` to `productVersion`, while `app.asar/dsh/desktop-runtime.json` retains the bundled engine version (`readDesktopRuntime(dsh).release.version`, see [Electron desktop packaging and updates](2026-08-25-electron-desktop-packaging-and-updates.md)) and `About StrataHarness`, GitHub Release Notes, and `pnpm run strata:status` surface `Engine: DSH <dshEngineVersion>` as a secondary reference line.

## Alternatives considered

**Rewrite root `package.json` and every `@deepseek-ai/dsh-*` manifest to `1.0.0`.** This unifies all `package.json` version strings, but guarantees merge conflicts across more than one hundred workspace manifests on every upstream `dsh-v*` merge and obscures which upstream engine release is bundled inside `app.asar/dsh`.

**Adopt compound upstream-prefixed versions such as `0.2.1-strata.1` or `0.2.1+strata.1`.** In SemVer, build metadata (`+strata.1`) is ignored during version precedence comparisons in `electron-updater`, breaking automatic updates between consecutive StrataHarness builds on the same upstream base, while prerelease suffixes (`-strata.1`) permanently label stable StrataHarness production builds as prereleases of `0.2.1`.

**Store `productVersion` only inside `apps/desktop/package.json`.** `scripts/check-workspace-constraints.ts` and `apps/desktop/scripts/prepare-dsh.ts` validate `apps/desktop/package.json` against the `@deepseek-ai/dsh` family version; diverging `apps/desktop/package.json` would require weakening upstream workspace constraints instead of feeding `extraMetadata.version` cleanly at the packaging layer.

## Consequences

- `strata-product.json` declares `productVersion: "1.0.0"` and `upstreamBaseTag: "dsh-v0.2.1-rc.4"`, matching all `packages/strata/*/package.json` manifests, while root `package.json` and `@deepseek-ai/dsh-*` manifests remain at the upstream engine version and pass `pnpm run constraints` without merge churn on `git merge dsh-v*`.
- `electron-builder` configuration, packaged `app.getVersion()`, installer artifact names, `electron-updater` metadata, and `DSH_CLIENT_VERSION` resolve to `productVersion`, while `app.asar/dsh/desktop-runtime.json` retains the bundled engine version and passes `afterPack` and `check:package`.
- `About StrataHarness`, generated GitHub Release Notes, and `pnpm run strata:status` display both the StrataHarness product version and the base `DSH` engine version.
- `pnpm run strata:version` updates `strata-product.json` and `packages/strata/*/package.json` atomically, and `scripts/strata/release-helper.ts` (`preflight`) plus `pnpm run strata:audit-overrides` reject any mismatch between a `strata-v*` Git tag, `strata-product.json`, and `@strata/*` manifests.

Code that assumes `app.getVersion()` equals the bundled `dsh` engine version in `desktop-runtime.json` fails if the two tracks are conflated; `check:package` validates packaged `desktop-runtime.json` against the bundled CLI, and `test:updates:local` qualifies `electron-updater` product-version upgrades (`1.0.0` to `1.0.1`) under `@strata/desktop`.
