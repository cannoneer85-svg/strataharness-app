---
description: "StrataHarness brand occupants for the sidebar and empty-conversation hero UI slots."
kind: "package-reference"
---

# @strata/ui-brand

## Summary

`@strata/ui-brand` supplies the layered geometric StrataHarness emblem and vector wordmark to the Web and Desktop UI slot registry (`sidebar.brand.mark`, `sidebar.brand.name`, and `conversation.hero.brand.mark`). It activates unconditionally across local and packaged builds while `@strata/product-bundle` disables `@deepseek-ai/dsh-client-ui-brand-official`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)

-----

<a id="use-this-package"></a>
## Use this package

`@strata/product-bundle` mounts `@strata/ui-brand` automatically in the Web and Desktop profile composition and disables `@deepseek-ai/dsh-client-ui-brand-official`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The browser entry [`src/client/index.ts`](src/client/index.ts) uses declaration-aware `ctx.slots.inject()` registrations so sidebar and hero occupants mount cleanly regardless of plugin activation order and withdraw automatically on disposal. Both [`StrataBrandMark`](src/client/Brand.tsx) and [`StrataBrandName`](src/client/Brand.tsx) render `aria-hidden="true"` vector SVG geometry driven by `currentColor` and `--dsw-alias-label-primary-inverted`, adapting seamlessly to dark and light themes.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.
