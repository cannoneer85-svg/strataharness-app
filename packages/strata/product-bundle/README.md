---
description: "Compose the StrataHarness product layer over dsh-base and dsh-web-app: disable upstream telemetry and cloud account services, resolve bundled StrataHarness skills, and configure the Strata and upstream agent preset lineup."
kind: "package-bundle"
---

# @strata/product-bundle

## Summary

`@strata/product-bundle` layers the StrataHarness product configuration over `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app` without modifying upstream core packages. It disables DeepSeek cloud account authentication and outbound telemetry, retains direct API-key (`llm-deepseek`) and multi-provider (`llm-pi-ai`) model adapters, provides validated paths to the bundled `resources/strataharness` methodology through `ctx.strataPaths`, and configures the 6 active presets (`Strata Developer` default with legacy `strata -> strata-developer` alias, `Standard mode`, `Strata Analyst`, `Strata Designer`, plus Coding Tools modes `PTC mode` and `Creator mode`) while keeping `Minimal mode` disabled.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The Web and Desktop profile template stacks `@strata/product-bundle` after `@deepseek-ai/dsh-web-app`. At startup, `StrataPaths` resolves `STRATAHARNESS_ROOT`, Electron `process.resourcesPath/strataharness`, ancestor `strataharness` or `resources/strataharness` directories (covering `ELECTRON_RUN_AS_NODE` child hosts inside `app.asar` and prepared `.desktop-build` runtime trees), and fails loud if `<root>/.agents/skills` is absent.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

[`cordis.patch.yml`](cordis.patch.yml) disables upstream telemetry, cloud-account login, `ui-brand-official`, and `preset-minimal`, sets `agent-preset-registry` default to `strata-developer` with alias `strata: strata-developer`, disables `includeHarnessIdentity` on `system-prompt`, and mounts `strata-paths` alongside `@strata/ui-brand` and `@strata/locale-ru`. The six files under `presets/` declare `strata-developer`, `strata-analyst`, and `strata-designer` alongside declarative overrides for upstream `standard`, `ptc`, and `cordis`, each configured with `thresholdChars: 32768` on `tool-result-pruner` so full `SKILL.md` bodies remain unpruned.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the active Strata preset's `persona`, `skill-filesystem`, `tool-skill`, `tool-ask-user` (`ask_user_question`), and role toolset. `StrataPaths` registers `{{strata_root}}` on `ctx.systemPrompt` so manual-only stage skills (`disable-model-invocation: true`) and `.agents/CONTEXT.md` remain readable via the `read` tool even in workspaces that have not copied `.agents/skills` locally.

#### KV Cache effect

Each preset's system prompt and tool catalog remain static for the lifetime of a session.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Custom role skills added at runtime under `skills/designer` require restarting or reloading the session when filesystem watching is disabled.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
