---
description: "Compose the StrataHarness product layer over dsh-base and dsh-web-app: disable upstream telemetry and cloud account services, resolve bundled StrataHarness skills, and register the four Strata presets."
kind: "package-bundle"
---

# @strata/product-bundle

## Summary

`@strata/product-bundle` layers the StrataHarness product configuration over `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app` without modifying upstream core packages. It disables DeepSeek cloud account authentication and outbound telemetry, retains direct API-key (`llm-deepseek`) and multi-provider (`llm-pi-ai`) model adapters, provides validated paths to the bundled `resources/strataharness` methodology through `ctx.strataPaths`, and registers four presets: `StrataHarness` (default), `Strata Developer`, `Strata Analyst`, and `Strata Designer`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The Web and Desktop profile template stacks `@strata/product-bundle` after `@deepseek-ai/dsh-web-app`. At startup, `StrataPaths` resolves `STRATAHARNESS_ROOT`, Electron `process.resourcesPath/strataharness`, or the repository `resources/strataharness` submodule and fails loud if `<root>/.agents/skills` is absent.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

[`cordis.patch.yml`](cordis.patch.yml) disables upstream telemetry, cloud-account login, and the four upstream presets, sets `agent-preset-registry` default to `strata`, disables `includeHarnessIdentity` on `system-prompt`, and mounts `strata-paths`. The four files under `presets/` compose `strata`, `strata-developer`, `strata-analyst`, and `strata-designer` with `thresholdChars: 32768` on `tool-result-pruner` so full `SKILL.md` bodies remain unpruned.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the active Strata preset's `persona`, `skill-filesystem`, `tool-skill`, `tool-ask-user` (`ask_user_question`), and role toolset. `StrataPaths` registers `{{strata_root}}` on `ctx.systemPrompt` so manual-only stage skills (`disable-model-invocation: true`) and `.agents/CONTEXT.md` remain readable via the `read` tool even in workspaces that have not copied `.agents/skills` locally.

#### KV Cache effect

Each preset's system prompt and tool catalog remain static for the lifetime of a session.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Packaged Electron builds must copy `resources/strataharness` into `extraResources/strataharness` (configured in Phase 3).
