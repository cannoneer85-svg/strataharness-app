---
description: "StrataHarness Soft-Fork product isolation packages for Russian localization, branding, and default agent preset compositions."
kind: "package-group"
---

# strata/ — Soft-Fork product packages

## Summary

This group isolates StrataHarness product-layer extensions from upstream `@deepseek-ai/dsh-*` packages so upstream merges stay localized. Its packages supply the Russian language pack (`@strata/locale-ru`), browser brand occupants (`@strata/ui-brand`), and the product composition bundle (`@strata/product-bundle`) that wires default presets, disabled telemetry, and localized metadata on top of `web-app`.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`locale-ru`](locale-ru/README.md) | Russian (`ru`) language registration, client dictionaries, and built-in plugin metadata catalog |
| [`product-bundle`](product-bundle/README.md) | Product composition layer disabling upstream telemetry/auth and configuring Strata presets |
| [`ui-brand`](ui-brand/README.md) | Browser-side StrataHarness emblem and wordmark slot occupants |

<a id="related-documentation"></a>
## Related documentation

- [Soft-Fork maintenance](../../docs/strata/fork-maintenance.md) — product isolation layers and dual-track versioning.
- [Product bundle](product-bundle/README.md) — Web and Desktop profile composition details.
- [Russian language pack](locale-ru/README.md) — `@strata/locale-ru` dictionary and metadata architecture.

<a id="dev-note"></a>
## Dev Note

None.
