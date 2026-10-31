# Agent Note: Soft-Fork 俄语语言包隔离与默认语言契约

Status: implemented

[English](2026-10-31-strata-russian-localization-pack.md) | 中文

## 问题

StrataHarness 作为基于 DeepSeek Harness 上游 `dsh-v*` 发布标签的受控 Soft-Fork 进行维护（参见[双轨产品版本管理](2026-10-29-strata-dual-track-product-versioning.zh.md)）。上游在 `packages/client/*`、`packages/extensions/*`、`packages/session-query/*` 与 `packages/experimental/*` 的 65 个 `LocaleNamespaceMap` 命名空间（外加 `directory-browser`）、两百多个 `locale/en.json` 与 `locale/zh.json` 插件元数据目录以及 `apps/desktop/src/locale.ts` 的 167 键 Electron 外壳字典中仅内置 `zh` 与 `en` 两种语言。

StrataHarness 需要为 Web/Desktop 客户端界面、Electron 原生菜单与对话框、内置 Strata 角色预设以及内置插件元数据提供完整的俄语（`ru`）本地化，并在未设置 `locale.preference` 时默认启用 `Русский`（`ru`），同时在 `Settings -> General -> Language` 中固定排序为 `Русский` -> `English` -> `中文`。若直接在 `packages/client/locale` 中将 `BuiltInLocaleId` 扩展为 `'ru' | 'en' | 'zh'`，则必须修改上游客户端包中的所有 `ctx.locale.register(ns, { zh, en })` 调用以及两百多个上游 `locale/` 目录，导致每次 `git merge dsh-v*` 都产生全仓范围的合并冲突。若在 `LocaleRuntime` 内无条件将 `FALLBACK_LOCALE` 从 `'en'` 改为 `'ru'`，既会破坏未挂载 `@strata/product-bundle` 的上游独立客户端单元测试，也会破坏仅提供 `en` 文案的第三方插件所依赖的英文终端字典回退不变式。最后，俄语计数表达需要三种复数类别（`one`、`few`、`many`），而上游命名空间仅向单一模板键传入 `{ count }`。

## 决策

StrataHarness 将俄语客户端字典与内置插件元数据翻译隔离在 `@strata/locale-ru`（`packages/strata/locale-ru`）中，通过 `@strata/product-bundle/cordis.patch.yml` 以客户端第一阶段激活（`dsh.client.immediately = true`）进行组合，并将上游核心修改严格限制在可审计的极小 `strata(override)` 范围内：

1. **`@deepseek-ai/dsh-client-locale` 上的可配置默认语言与展示顺序：** `packages/client/locale` 暴露经校验的 Cordis `Config` 字段（`defaultLocale?: LocaleId` 与 `localeOrder?: readonly LocaleId[]`）。当配置了 `defaultLocale`（在 `@strata/product-bundle/cordis.patch.yml` 中设为 `'ru'`）且未存储显式 `locale.preference` 时，`LocaleRuntime` 在该语言已注册时优先选用 `defaultLocale` 而非委托给 `navigator.languages`，同时保留 `FALLBACK_LOCALE = 'en'` 作为逐键字典回退终点（`ru -> en`），并在未传入 `Config` 的上游独立单元测试中保持原有默认行为。`localeOrder: ['ru', 'en', 'zh']` 保证 `LocaleSnapshot.locales` 无论注册顺序如何都按固定顺序输出。
2. **`@strata/locale-ru` 中的类型化命名空间字典与集中式 `LocalizedText` 目录：** `@strata/locale-ru` 在启动第一阶段（`immediately: true`，由 `dsh-client-locale` 延迟初始 `<html lang>` 与 `__DSH_LOCALE__.onChange` 同步直至目标语言就绪，消除启动语言闪烁）通过 `ctx.locale.addLanguage` 注册 `'ru'`（`label: 'Русский'`，`fallback: 'en'`），并注册全部 66 个客户端字典（对照 `LocaleDictOf<N>` 校验的 65 个 `LocaleNamespaceMap` 命名空间以及 `directory-browser`）。对于流经 `LocaleRuntime.resolveText(text)` 的内置插件标题/描述、官方按需捆绑包卡片与内置审批提示（遵循[由 locale 拥有的客户端 UI 文案](2026-08-23-locale-owned-client-ui-copy.zh.md)），`LocaleRuntime` 优先解析显式 `text.ru` 字段（支持 `packages/strata/*/locale/ru.json` 与自带 `locale/ru.json` 的第三方插件），随后查询通过 `ctx.locale.registerTextCatalog` 注册的 522 条 `ruPluginMetadataCatalog`（含无 `locale/en.json` 的 `@deepseek-ai/*`、`@strata/*` 与 `cordis:*` 内置插件纯字符串元数据，由 `PluginInventorySettingsTab` 与 `ui-plugin-manager` 按内置作用域包装且保留用户字面字符串不变），否则通过 `text.en` 保留外部提供的数据。
3. **基于标准 `Intl.PluralRules` 的复数插值且不改动上游键集：** `LocaleRuntime.translate` 使用命中字典条目所属语言的平台 `Intl.PluralRules`（`hit?.locale ?? activeLocale`，对非标准合成 BCP 47 标签回退至英文复数规则）解析 ICU 风格复数子句（`{count, plural, one {# ...} few {# ...} many {# ...} other {# ...}}`），同时保持普通 `{param}` 替换完全兼容，在不引入任何外部 npm 依赖、也不改动上游客户端包键名的前提下格式化俄语复数计数（`1 файл`、`2 файла`、`5 файлов`）。
4. **Electron 外壳、早期启动页与 Strata 角色预设：** `apps/desktop/src/locale.ts` 提供完整的 167 键类型化 `ru` 字典，并在 `preference` 为空时将 `resolveDesktopStartupLocale` 与 Host 就绪前的早期致命恢复对话框默认设为 `'ru'`，同时支持区域子标签（`ru-RU`、`en-US`、`zh-CN`）归一化以及未知标签的清洁回退（不覆盖已保存偏好）。`packages/client/web/src/boot-page.ts` 默认展示 `STRATA HARNESS` 品牌与俄语启动状态文案。`packages/preset/agent-preset-registry/src/display.ts` 与 `ui-agent-preset` 将 `strata`、`strata-developer`、`strata-analyst` 和 `strata-designer` 识别为内置预设，提供 `ru`/`en`/`zh` 本地化描述，同时保留原有角色名称与面向模型的英文系统提示词。

## 曾考虑的替代方案

**直接将 `'ru'` 加入 `LOCALE_IDS`（`BuiltInLocaleId`）并修改所有上游包。** 修改五十多个 `packages/client/*/locales.ts` 模块并新增两百多个 `packages/*/*/locale/ru.json` 文件会在每次同步上游 `dsh-v*` 时制造大面积合并冲突，而独立的 `@strata/locale-ru` 能在单一 `@strata/*` 包内提供编译期 `LocaleDictOf<N>` 键集校验与运行时对等检查。

**全局将 `FALLBACK_LOCALE = 'en'` 替换为 `'ru'`。** `FALLBACK_LOCALE` 同时承担无俄语字典的第三方插件的终端回退语言（`assertFallbackChain` 要求每条回退链都收敛到 `FALLBACK_LOCALE`）以及上游独立单元测试的基线预期；将部署级 `defaultLocale` 与 `FALLBACK_LOCALE` 分离可同时满足两项约束。

**在第二启动批次加载 `@strata/locale-ru` 或异步懒加载俄语字典。** `@deepseek-ai/dsh-client-locale` 以 `immediately: true` 运行；将 `@strata/locale-ru` 推迟到第二阶段会导致初始界面挂载与 Electron `__DSH_LOCALE__` 桥接先以 `'en'` 渲染再切换到 `'ru'`，造成原生菜单和界面的可见闪烁。

**将上游计数键拆分为多键复数形式或引入外部 ICU 解析依赖。** 跨上游客户端包重命名键会破坏 Soft-Fork 隔离，且标准库 `Intl.PluralRules` 仅需极少自包含代码即可完成复数选择，无需新增第三方依赖。

## 后果

- `@strata/locale-ru` 在客户端启动第一阶段（`immediately: true`）激活，纳入 `strata-product.json` 版本同步（`pnpm run strata:version`）与 `pnpm run strata:audit-overrides`（`scripts/strata/fork-ops.ts`），并在全新 Web 与 Desktop 配置下默认以 `'ru'` 启动且语言选择器顺序固定为 `['Русский', 'English', '中文']`。
- `scripts/strata/russian-localization-parity.spec.ts` 强制校验全部 66 个客户端字典、`apps/desktop/src/locale.ts` 中全部 167 个 Electron 外壳键以及所有内置插件 `locale/en.json`、纯字符串内置 YAML 插件说明符和 `OFFICIAL_ON_DEMAND_CATALOG` 元数据条目的 100% `ru` 键集与占位符对等性，当上游 `dsh-v*` 合并引入未翻译文案时确定性报错。
- 区域子标签（`ru-RU`、`en-US`、`zh-CN`）、未知偏好标签以及手动禁用 `@strata/locale-ru` 均能平滑回退，不抛出异常、不暴露裸键名，也不覆盖已保存的 `locale.preference`；同时上游独立的 `packages/client/*` 单元测试无需修改即可通过，且 `LocaleRuntime.translate` 通过 `Intl.PluralRules('ru')` 格式化俄语 `one` / `few` / `many` 复数分支。

当上游 `dsh-v*` 版本重命名 `LocaleNamespaceMap` 键或更改 `locale/en.json` 英文描述时，`@strata/locale-ru` 的 TypeScript 编译（`LocaleDictOf<N>`）以及 `scripts/strata/russian-localization-parity.spec.ts` 会在 `sync/dsh-v*` 同步分支上失败，直至更新 `@strata/locale-ru` 或 `apps/desktop/src/locale.ts`，从而防止已发布的 StrataHarness 版本出现静默回退到英文的回归。俄语 UI 文案通常比英文长 25%–35%，因此紧凑型设置胶囊、侧边栏条目与页头需采用精炼的工程化表述并验证布局。
