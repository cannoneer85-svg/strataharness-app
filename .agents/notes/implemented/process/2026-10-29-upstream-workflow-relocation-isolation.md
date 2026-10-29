# Agent Note: Isolate upstream GitHub Actions workflows via archive relocation

Status: implemented

English | [中文](2026-10-29-upstream-workflow-relocation-isolation.zh.md)

## Problem

GitHub Actions automatically discovers and registers every `.yml` workflow file located directly inside `.github/workflows/`. The upstream DeepSeek Harness repository ships twenty-five workflow files in `.github/workflows/`: although push triggers target `master`, eleven workflows listen on `pull_request`, `pull_request_target`, `pull_request_review`, `issues`, and `issue_comment`, and rely on DeepSeek-internal self-hosted runners, review-ownership bots, and organization secrets.

When the StrataHarness Soft-Fork is pushed to its own GitHub `origin`, leaving those twenty-five files inside `.github/workflows/` causes failing workflow runs on pull requests and issues and clutters the Actions UI with unusable upstream pipelines. Conversely, deleting the twenty-five files breaks nine upstream Vitest workflow contract suites (`scripts/*workflow*.spec.ts` and `scripts/tests/ci-*.spec.ts`) and turns future upstream workflow edits during `git merge dsh-v*` into modify/delete conflicts.

## Decision

All twenty-five upstream workflow files live byte-for-byte unchanged under `.github/upstream-workflows/*.yml` via `git mv`, reserving `.github/workflows/` exclusively for StrataHarness workflows named `.github/workflows/strata-*.yml`.

Only the workflow directory path constants in the upstream Vitest workflow spec files and review-ownership helper scripts carry `strata(override)` edits so `pnpm run test` validates the upstream YAML corpus against `.github/upstream-workflows/` while Git's `ort` merge strategy tracks the 100%-similar renames automatically across future `dsh-v*` merges. `scripts/strata/fork-ops.ts` (`audit-overrides`) and `scripts/strata/strata-workflows.spec.ts` enforce the invariant mechanically, failing whenever any file not matching `strata-*.yml` enters `.github/workflows/`.

## Alternatives considered

**Keep upstream workflows in `.github/workflows/` and inject `if: github.repository == 'deepseek-ai/deepseek-harness'` into every job.** Editing all jobs across twenty-five YAML files fails upstream Vitest workflow contract assertions that inspect exact triggers and job fields, leaves twenty-five inactive workflows listed in the GitHub Actions sidebar, and creates widespread YAML merge conflicts on upstream syncs.

**Delete all twenty-five upstream workflow files.** Deletion breaks the nine upstream workflow Vitest suites unless those suites are also deleted or skipped, and converts every upstream workflow change on future `dsh-v*` merges into a modify/delete conflict instead of a clean rename-tracked merge.

**Disable workflows manually through the GitHub repository web settings.** UI-only state is neither version-controlled nor reproducible across forks or mirrors, and newly added upstream workflows would default to enabled on merge before an administrator noticed them.

## Consequences

- All twenty-five upstream workflow YAML files reside byte-for-byte unchanged under `.github/upstream-workflows/`, and `.github/workflows/` contains exclusively the four `strata-*.yml` workflows (`strata-windows-package.yml`, `strata-macos-package.yml`, `strata-release.yml`, and `strata-upstream-watch.yml`).
- All nine upstream workflow Vitest suites pass against `.github/upstream-workflows/` without weakening their structural YAML assertions.
- `pnpm run strata:audit-overrides` and `scripts/strata/strata-workflows.spec.ts` fail immediately if any non-`strata-*.yml` file appears in `.github/workflows/`.

When a future upstream `dsh-v*` release introduces a brand-new `.github/workflows/<new>.yml` file rather than modifying one of the twenty-five renamed files, Git places that new file in `.github/workflows/` during `git merge --no-commit dsh-v*`; running `pnpm run strata:audit-overrides` during the mandatory sync gate and CI preflight catches new upstream workflows deterministically so they are moved via `git mv` into `.github/upstream-workflows/` before commit.
