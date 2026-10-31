---
description: "StrataHarness Russian language pack for Web and Desktop client localization."
kind: "package-reference"
---

# @strata/locale-ru

## Summary

`@strata/locale-ru` registers the Russian (`ru`, `Русский`) language definition and typed Russian UI dictionaries on `ctx.locale` during Phase-1 client boot (`immediately: true`). `@strata/product-bundle` mounts `@strata/locale-ru` alongside `defaultLocale: 'ru'` and `localeOrder: ['ru', 'en', 'zh']` so StrataHarness opens in Russian by default while keeping English and Simplified Chinese selectable.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

`@strata/product-bundle` mounts `@strata/locale-ru` automatically in Web and Desktop compositions and configures `@deepseek-ai/dsh-client-locale` with `defaultLocale: 'ru'` and `localeOrder: ['ru', 'en', 'zh']`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The browser entry [`src/client/index.ts`](src/client/index.ts) declares `inject = ['locale']` and registers the `ru` language (`fallback: 'en'`) and typed `LocaleDictOf<...>` dictionaries through `ctx.effect()`, so disabling or unloading the plugin unwinds cleanly to English without mutating `locale.preference`.

Domain dictionary modules live under `src/client/locales/`:

- [`common.ts`](src/client/locales/common.ts) — `common` and `settings.locale`.
- [`settings.ts`](src/client/locales/settings.ts) — `settings`, `settings.theme`, `settings.account`, `settings.agentLoop`, `settings.sessionLog`, `settings.shell`, `settings.subagent`, `settings.webSearch`, `settings.permission`, `settings.plugins`, and `secretMask`.
- [`models.ts`](src/client/locales/models.ts) — `settings.models`, `model`, and `deepseek-model-label-1017`.
- [`agent-preset.ts`](src/client/locales/agent-preset.ts) — `settings.agentPreset`, including built-in guides and localized Russian descriptions for the four Strata role presets (`strata`, `strata-developer`, `strata-analyst`, `strata-designer`).
- [`plugins.ts`](src/client/locales/plugins.ts) — `settings.pluginInventory`, `pluginManager`, `pluginMarket`, and `entryCustomization`.
- [`navigation.ts`](src/client/locales/navigation.ts) — `sidebar`, `sidebarRight`, `workspace`, `directory-browser`, `shortcuts`, `shortcuts.layout`, `command`, `open-in-app`, and `permission.access`.
- [`conversation.ts`](src/client/locales/conversation.ts) — `conversation`, `chat`, `trajectory`, `approval`, `question`, `feedback`, `reference`, `slash.menu`, `deliverables`, and `session-log-download`.
- [`agent-capabilities.ts`](src/client/locales/agent-capabilities.ts) — `plan`, `goal`, `job`, `subagent`, `skill`, `workflowRun`, `schedule.catalog`, `schedule.manager`, and `cordis`.
- [`sidebars-and-viewers.ts`](src/client/locales/sidebars-and-viewers.ts) — `sidebarFiles`, `sidebarTerminal`, `sidebarBrowser`, `sidebarDocumentPreview`, `sidebarCodePreview`, `documentMarkdown`, `documentHtml`, `sidebarImage`, `sidebarPdf`, `sidebarExcel`, and `sidebarOffice`.
- [`experimental.ts`](src/client/locales/experimental.ts) — `agent-team`, `claude-code-mods`, `cotTranslation`, `voice-input`, `inspectorPanel`, and `session-inspector`.
- [`plugin-metadata.ts`](src/client/locales/plugin-metadata.ts) — `ruPluginMetadataCatalog`, registering 455 `en -> ru` translations via `ctx.locale.registerTextCatalog` for built-in plugin `locale/en.json` titles and descriptions, official on-demand bundles, and built-in approval prompts.

Package manifest metadata lives in [`locale/en.json`](locale/en.json), [`locale/ru.json`](locale/ru.json), and [`locale/zh.json`](locale/zh.json) so `@strata/locale-ru` self-describes across all three supported UI languages in the plugin inventory.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package contributes browser localization dictionaries and metadata translations only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Supplies Russian (`ru`) UI dictionaries only; system prompts and model-facing tool schemas remain in English.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
