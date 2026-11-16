# Coding Standards

Engineering judgement rules and architectural standards for `strataharness-app`, supplementing [AGENTS.md](AGENTS.md) during development, `/code-review` (Standards axis), and `/retro`. Mechanical style, formatting, and compiler checks belong in `oxlint`, TypeScript, and `scripts/run-gates.ts` — keep this file strictly for human judgement calls.

## Soft-Fork Isolation

- **Isolate product features under Soft-Fork directories:** Keep StrataHarness composition, preset overlays, branding, Russian localization, and release tooling inside `packages/strata/*`, `scripts/strata/*`, `.github/workflows/strata-*.yml`, and `resources/strataharness` ([fork-maintenance.md](docs/strata/fork-maintenance.md)).
- **Prefer declarative Cordis/YAML overlays over core edits:** Configure product behavior through `@strata/product-bundle` overlays and service injection instead of modifying upstream `@deepseek-ai/dsh-*` or `packages/bundle/web-app/` files. When an upstream modification is unavoidable, keep it minimal, isolate it behind a `strata(override):` commit, and never edit `@deepseek-ai/dsh-*` package versions manually (`strata-product.json` owns product SemVer).

## Architecture and Deep Modules

- **Deep modules over shallow wrappers:** Expose narrow public entrypoints and complete `Service Definition / Service Provider / Consumer` capability seams ([architecture.md](docs/architecture.md), [codebase-design](.agents/skills/codebase-design/SKILL.md)). Avoid speculative abstractions or single-implementation interfaces added "just in case".
- **Respect Cordis lifecycle and compiler faces:** Register every contribution via `ctx.effect()` or `ctx.on()` so fiber disposal cleans up deterministically, keep Host and Client faces strictly separated, and never mix source-plane imports (`src/`) with built-artifact verification (`lib/`).

## Configuration, Validation, and Failing Loud

- **Explicit configuration resolution:** Model defaulting as an explicit `resolve(request): Spec` step at package entrypoints rather than hidden `?? default` fallbacks inside runtime execution, and expose deployment-varying choices through validated Cordis `Config` schemas rather than hardcoded constants.
- **No production fallback endpoints or secrets:** Never embed real tokens, credentials, or production/internal URLs as default fallbacks in code (`process.env.X || "..."`). Validate untrusted inputs once at parser, config, durable file, IPC, subprocess, and network trust boundaries.
- **Fail loud with typed context:** Surface misconfiguration and violated invariants immediately using typed `HarnessError` or `RemoteError` failures with clear handling ownership and containment ([defensive-patterns](docs/defensive-patterns/README.md)); never swallow unexpected errors silently.

## Session Durability, Localization, and Documentation Parity

- **Immutable historical sessions and logged model inputs:** Anything visible to the model must be reconstructable from the session log (`SessionEventMap`). Handle legacy session identifiers and formats at read/lookup time via aliases, projections, or adjacent versioned migrations without mutating historical session files.
- **Locale-owned UI copy and 100% Russian parity:** Route every Client UI and Electron shell string through typed dictionaries so `@strata/locale-ru` and `russian-localization-parity.spec.ts` enforce complete Russian coverage, keeping model-facing system prompts and agent files in English.
- **One home per fact and bilingual pairing:** Keep active English/Chinese doc pairs and owning [Agent Notes](.agents/notes/README.md) synchronized in the same change ([docs/AGENTS.md](docs/AGENTS.md)), placing durable rationale in `.agents/notes/` rather than duplicating rules across tiers.

## Testing Judgement and Verification Scope

- **Behavior-driven TDD through public seams:** Write tests before or alongside changes (`tdd`, [testing.md](docs/testing.md)) that assert observable behavior through public APIs and configuration composition rather than private internals, maintaining 100% per-file coverage on `packages/*/*/src`.
- **Match verification scope to the loop:** Run fast, targeted unit and gate checks during ticket implementation (`red -> green -> refactor`); reserve heavy full-suite, coverage, snapshot, and desktop packaging runs for pre-commit/CI or explicit verification requests.
