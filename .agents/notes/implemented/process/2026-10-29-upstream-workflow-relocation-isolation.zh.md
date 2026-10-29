# Agent Note: 通过归档目录迁移隔离上游 GitHub Actions 工作流

Status: implemented

[English](2026-10-29-upstream-workflow-relocation-isolation.md) | 中文

## 问题

GitHub Actions 会自动发现并注册直接位于 `.github/workflows/` 目录下的所有 `.yml` 工作流文件。上游 DeepSeek Harness 仓库在 `.github/workflows/` 中提供了二十五个工作流文件：尽管 `push` 触发器仅针对 `master` 分支，但其中十一个工作流监听 `pull_request`、`pull_request_target`、`pull_request_review`、`issues` 和 `issue_comment` 事件，且依赖 DeepSeek 内部自托管运行器、代码评审归属机器人与组织级密钥。

当 StrataHarness Soft-Fork 推送到自身的 GitHub `origin` 时，若将这二十五个文件保留在 `.github/workflows/` 中，会在提交 PR 与创建 Issue 时触发必然失败的工作流运行，并在 Actions 界面中混入大量不可用的上游流水线。反之，若直接删除这二十五个文件，则会破坏九个上游 Vitest 工作流契约测试套件（`scripts/*workflow*.spec.ts` 与 `scripts/tests/ci-*.spec.ts`），并在后续执行 `git merge dsh-v*` 时将所有上游工作流改动演变为修改/删除冲突。

## 决策

全部二十五个上游工作流文件通过 `git mv` 按字节原样存放于 `.github/upstream-workflows/*.yml`，不做任何内容修改，使 `.github/workflows/` 仅保留命名为 `.github/workflows/strata-*.yml` 的 StrataHarness 自有工作流。

仅在上游 Vitest 工作流测试与评审归属辅助脚本中通过 `strata(override)` 改动更新工作流目录路径常量，从而让 `pnpm run test` 继续针对 `.github/upstream-workflows/` 校验上游 YAML 集合，同时使 Git 的 `ort` 合并策略能够在后续合并 `dsh-v*` 时自动追踪 100% 相似度的重命名。`scripts/strata/fork-ops.ts`（`audit-overrides`）与 `scripts/strata/strata-workflows.spec.ts` 通过机械检查强制执行该不变量：一旦 `.github/workflows/` 中出现任何不匹配 `strata-*.yml` 的文件，检查立即失败。

## 曾考虑的替代方案

**将上游工作流保留在 `.github/workflows/` 中，并为每个作业注入 `if: github.repository == 'deepseek-ai/deepseek-harness'`。** 修改二十五个 YAML 文件中的所有作业会破坏检查精确触发器与作业字段的上游 Vitest 工作流契约断言，在 GitHub Actions 侧边栏留下二十五个无效工作流条目，并在上游同步时引发大面积 YAML 合并冲突。

**直接删除全部二十五个上游工作流文件。** 除非一并删除或跳过九个上游工作流 Vitest 测试套件，否则删除文件会导致测试失败，且每次上游 `dsh-v*` 修改工作流都会产生修改/删除冲突，无法享受重命名自动合并。

**在 GitHub 仓库网页设置中手动禁用工作流。** 仅存在于网页界面的开关状态既不受版本控制，也无法在派生仓库或镜像仓库之间复现，而且上游新增的工作流在合并后会默认处于启用状态。

## 后果

- 全部二十五个上游工作流 YAML 文件按字节原样位于 `.github/upstream-workflows/` 下，且 `.github/workflows/` 仅包含四个 `strata-*.yml` 工作流（`strata-windows-package.yml`、`strata-macos-package.yml`、`strata-release.yml` 与 `strata-upstream-watch.yml`）。
- 全部九个上游工作流 Vitest 测试套件均针对 `.github/upstream-workflows/` 通过，且不削弱任何 YAML 结构断言。
- 一旦 `.github/workflows/` 中出现任何非 `strata-*.yml` 文件，`pnpm run strata:audit-overrides` 与 `scripts/strata/strata-workflows.spec.ts` 会立即报错失败。

当未来某个上游 `dsh-v*` 版本新增了全新的 `.github/workflows/<new>.yml` 文件而非修改已重命名的二十五个文件之一时，Git 会在执行 `git merge --no-commit dsh-v*` 期间将该新文件放入 `.github/workflows/`；在同步必选门禁与 CI 预检中执行 `pnpm run strata:audit-overrides` 可确定性地拦截该新文件，确保在提交前通过 `git mv` 将其迁入 `.github/upstream-workflows/`。
