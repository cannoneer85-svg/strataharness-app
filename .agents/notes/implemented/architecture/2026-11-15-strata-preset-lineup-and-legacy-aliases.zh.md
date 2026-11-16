# Agent Note: Strata 角色预设阵容、无仪式标准模式与旧版预设 ID 别名

Status: implemented

[English](2026-11-15-strata-preset-lineup-and-legacy-aliases.md) | 中文

## 问题

在 `strata-v1.0.0` 至 `strata-v1.0.2` 中，[产品组合包补丁](../../../../packages/strata/product-bundle/cordis.patch.yml) 暴露了四个内置角色预设（`strata`、`strata-developer`、`strata-analyst` 与 `strata-designer`），同时禁用了上游的 `standard`、`ptc`、`minimal` 与 `cordis` 预设（参见[双轨产品版本管理](2026-10-29-strata-dual-track-product-versioning.zh.md)）。`strata` 与 `strata-developer` 组合了完全相同的六阶段停止门方法论工作流和完全一致的工具集，在设置和预设选择器中造成明显重复，同时也使用户缺少等同于上游 `standard` 的直接无仪式编码模式。

若直接移除 `strata`，则在 [AgentPresetRegistry](../../../../packages/preset/agent-preset-registry/src/index.ts) 中打开会话日志头部记录为 `agentPreset: "strata"` 的旧版 `strata-v1.0.x` 会话，或读取保存了 `selectedDefault: "strata"` 的用户配置时，会因抛出 `agent-preset/not-found` 而失败。仅重新启用上游 `standard` 也不充分：在包含 StrataHarness 模板 `AGENTS.md` 的工作区中，上游 `standard` 会读取 Step 0 分类和多阶段停止门规则，却缺乏指示模型遵循代码规范但跳过方法论仪式的指令（除非用户明确要求），从而模糊了 `standard` 与 `strata-developer` 的区别。最后，在后端启用 `cordis` 但未在[客户端预设设置存储](../../../../packages/client/ui-agent-preset/src/client/settings-store.ts) 的 `requiresCodingTools` 中将其与 `ptc` 一并纳入过滤，会导致在关闭开发者工具开关时 `cordis` 及其创建者草稿入口仍然可见。

## 决策

StrataHarness 在 `@strata/product-bundle` 内将内置预设阵容组织为四个默认模式加两个按需开启的编码工具模式，并配合查询期别名映射与声明式 Soft-Fork 覆盖层：

1. **去重后的核心阵容（默认 `strata-developer`）：** 从 `@strata/product-bundle` 移除重复的 `strata` 预设定义，通过[产品组合包补丁](../../../../packages/strata/product-bundle/cordis.patch.yml) 与 `packages/strata/product-bundle/presets/` 下的预设补丁文件默认提供四个内置模式：`strata-developer`（`order: 1`，注册表 `default`）、`standard`（`order: 2`）、`strata-analyst`（`order: 3`）和 `strata-designer`（`order: 4`）。在后端启用 `ptc`（`order: 5`）和 `cordis`（`order: 6`）同时保持 `minimal` 禁用，并通过[客户端预设设置存储](../../../../packages/client/ui-agent-preset/src/client/settings-store.ts) 中的 `requiresCodingTools`（`ptc`、`minimal`、`cordis`）将 `ptc`、`cordis` 以及设置页中的创建者草稿入口隐藏至开启开发者工具（`developerTools`）为止。
2. **透明的旧版预设 ID 别名（`aliases`）：** `AgentPresetRegistry.Config` 提供经校验的 `aliases: Record<string, string>` 字段（在[预设配置](../../../../packages/preset/agent-preset-registry/src/preset.ts) 中默认 `{}`），并在[产品组合包补丁](../../../../packages/strata/product-bundle/cordis.patch.yml) 中配置 `{ strata: 'strata-developer' }`。[AgentPresetRegistry](../../../../packages/preset/agent-preset-registry/src/index.ts) 在 `defaultId`、`resolve()`、`retain()` 和 `readDocument()` 中通过别名表将请求 ID 规范化为目标预设，而 `list()` 仅输出规范预设定义；客户端同步通过 `LEGACY_PRESET_ALIASES` 与 `findPresetOption` 镜像映射，使 `strata-v1.0.x` 会话与 `selectedDefault: "strata"` 无缝解析到 `strata-developer` 并将其高亮为默认预设，同时不在 UI 列表中重新暴露 `strata`。
3. **声明式 Soft-Fork 预设覆盖与 Office 工具（`dsh-v0.2.2-rc.3`）：** `@strata/product-bundle` 不直接修改 `packages/bundle/web-app/presets/` 下的上游文件，而是在 `packages/strata/product-bundle/presets/` 中覆盖 `preset-standard`、`preset-ptc` 与 `preset-cordis`，并与 `strata-developer`、`strata-analyst`、`strata-designer` 一并组合。全部六个启用模式统一配置 `tool-result-pruner`（`thresholdChars: 32768`、`headChars: 16384`、`tailChars: 4096`）；`standard` 配置紧凑且静态的 `persona.prefix`，指示代理遵守工作区 `AGENTS.md` 中的技术约定、测试命令与 git 安全护栏并跳过 Step 0 分类与停止门提示（除非用户明确要求）；`strata-developer` 在 Step 0 增加可选的工作区骨架初始化提示（`AGENTS.md`、`.agents/CONTEXT.md`、ADR 目录）与无 `pwsh` 时的纯文件回退方案；Desktop 中的 Office 文档能力通过宿主层 `@deepseek-ai/dsh-skill-office`（挂载于 [web-app 宿主补丁](../../../../packages/bundle/web-app/cordis.patch.yml)）与预设级 `@deepseek-ai/dsh-tool-office`（`id: tool-office`，启用在 `strata-developer`、`standard`、`strata-analyst` 与 `ptc`）以及对齐 `dsh-v0.2.2-rc.3` 的 `delegation` 分组（`workflowEngine: true` 与 `@deepseek-ai/dsh-tool-subagent-control`）协作实现。
4. **俄语本地化与卡片页头排版：** [Soft-Fork 俄语语言包](2026-10-31-strata-russian-localization-pack.zh.md) 与 `@strata/locale-ru` 将本地化预设名称和描述与 `resources/strataharness` `v1.4.6` 的 `41` 个方法论技能同步，将俄语 `inUse` 徽章缩短为 `'По умолчанию'`，并在 `ui-agent-preset` 中调整预设卡片页头换行以防止标题被挤压截断。

## 曾考虑的替代方案

**在预设选择器中同时保留 `strata` 与 `strata-developer`。** 同时保留两个预设会延续用户对两个完全相同工程工作流的困惑，且仍无法提供无仪式直接编码模式。

**移除 `strata-developer` 仅保留 `strata` 作为工程模式。** 保留 `strata` 会破坏其与 `strata-analyst`、`strata-designer` 之间的角色命名对称性，而且依然需要为现有 `strata-developer` 会话维护别名映射表。

**改写磁盘上历史会话文件中的 `agentPreset` 字段。** 修改追加写入式的会话日志会破坏事件溯源会话的不可变性，且在只读、导出或外部分享的会话文件上会失败；相比之下，查询期别名解析无需改动磁盘即可兼容全部历史会话。

**直接修改上游 `standard`、`ptc` 和 `cordis` 补丁文件。** 修改 `packages/bundle/web-app/presets/` 内的文件会在后续合并 `dsh-v*` 上游更新时扩大 `strata(override)` 冲突范围，而在 `@strata/product-bundle` 内通过覆盖层组合配置可保持策略隔离。

## 后果

- 在关闭开发者工具时，客户端选择器与设置列表按顺序精确显示四个内置预设（`strata-developer` 标记为默认、`standard`、`strata-analyst` 和 `strata-designer`），不显示 `strata` 或创建者草稿按钮；开启开发者工具后显示 `ptc`、`cordis` 与创建者草稿入口，同时保持 `minimal` 禁用。
- 通过 `AgentPresetRegistry` 与 `findPresetOption` 打开包含 `agentPreset: "strata"` 的 `strata-v1.0.x` 已保存会话或读取 `selectedDefault: "strata"` 设置时，均无需修改磁盘即可解析到 `strata-developer`，且不会将 `strata` 单独列为选项。
- 上游 `standard`、`ptc` 与 `cordis` 在 `@strata/product-bundle` 内声明式继承 Soft-Fork 的 `persona.prefix`、`tool-result-pruner` 与 `tool-office` 策略，同时保持上游 `packages/bundle/web-app/presets/` 干净无改动；Desktop 中的 Office 运行时初始化亦与 `dsh-v0.2.2-rc.3` 宿主/预设契约保持一致。

将 `strata` 映射至 `strata-developer` 会让旧版 `strata` 会话沿用 `strata-developer` 的系统提示词与工具集；由于两者此前已挂载等效工具和方法论规则，此兼容性影响可忽略不计。在 `standard` 中抑制 `AGENTS.md` 停止门依赖 `persona.prefix` 覆盖层的指令优先级，该行为已在 `@strata/product-bundle` 预设组合测试中持续验证。
