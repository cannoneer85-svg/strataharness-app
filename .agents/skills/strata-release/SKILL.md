---
name: strata-release
description: "Prepare and cut a StrataHarness Desktop release — preflight checks, changelog preview, Russian product release summary, optional version bump, local release commit and strata-v* tag, then user-confirmed git push."
disable-model-invocation: true
---

# Strata Release

Prepare and cut a `StrataHarness Desktop` release (`strata-v<version>`): run preflight checks, preview changes since the previous release, confirm the target SemVer and Russian product release highlights with the user, create the local release commit and annotated `strata-v*` tag, and push to `origin` strictly after explicit user confirmation.

Run only on explicit user invocation (`/strata-release`). Never push without explicit approval at Step 4, never overwrite or `--force` an existing `strata-v*` tag, and never push to `upstream` (`deepseek-ai/deepseek-harness`). Operational background lives in [`docs/strata/fork-maintenance.md`](../../../docs/strata/fork-maintenance.md).

## 1. Preflight

Record every preflight check before modifying any file or Git reference (on Windows `pwsh`, ensure `C:\Windows\System32` precedes `C:\Program Files\Git\usr\bin` in `PATH`):

1. **Clean working tree and active branch** — run `git status --short` and `git branch --show-current`. If any tracked or untracked modifications exist, list the dirty paths and **stop immediately** so unfinished work never enters a release commit. If `git branch --show-current` is empty (detached `HEAD`), **stop immediately** and ask the user to check out the release branch (typically `main`).
2. **Fork and override health** — run `pnpm run strata:status` and `pnpm run strata:audit-overrides`. If either command exits non-zero (version drift across `packages/strata/*`, uninitialized `resources/strataharness` submodule, or unaudited upstream modifications), report the failure and **stop**.
3. **Sync remote tags, check branch ancestry, and inspect `strata-v*` tags** — read `productVersion` and `upstreamBaseTag` from [`strata-product.json`](../../../strata-product.json). When remote `origin` is configured (`git remote get-url origin`; abort if `origin` points to `deepseek-ai/deepseek-harness`), run `git fetch origin --tags` so all remote `strata-v*` and `dsh-v*` tags exist in local `.git/refs/tags/`, and verify `origin/<branch>` (when present) is an ancestor of `HEAD` (`git merge-base --is-ancestor origin/<branch> HEAD`; abort if local `<branch>` is behind or diverged from `origin/<branch>`). List all tags with `git tag -l "strata-v*"` and `git ls-remote --tags origin "refs/tags/strata-v*"`; treat `strata-v<V>` as occupied whenever it exists locally or on `origin`. Also verify `git rev-parse --verify --quiet "<upstreamBaseTag>^{commit}"` succeeds locally (abort if `upstreamBaseTag` is missing).
4. **Release mode detection and changelog preview** — branch on whether `strata-v<productVersion>` is already occupied:
   - **Case A — Unreleased current version** (`strata-v<productVersion>` does **not** exist locally or on `origin`, such as the initial `1.0.0` release when `strata-product.json` already sets `"productVersion": "1.0.0"`):
     - Run `pnpm run strata:changelog -- --version <productVersion> --json` and `pnpm run strata:changelog -- --version <productVersion>`.
     - Recommend `<targetVersion> = <productVersion>` **without** bumping to `<next>` (initial `1.0.0` releases as `1.0.0`, comparing against `upstreamBaseTag`, e.g. `dsh-v0.2.1-rc.4`).
     - Reuse `docs/strata/releases/v<productVersion>.md` when already authored (such as [`docs/strata/releases/v1.0.0.md`](../../../docs/strata/releases/v1.0.0.md)); otherwise draft a Russian product summary from the collected changes.
   - **Case B — Already released current version** (`strata-v<productVersion>` **already** exists locally or on `origin`):
     - Run `pnpm run strata:changelog -- --base strata-v<productVersion> --json` to inspect commits and platform deltas since `strata-v<productVersion>`.
     - **Zero-change block:** if `hasChanges` is `false` (`totalCommits === 0` and `platformUpdates.length === 0`), warn the user that zero functional commits, engine upgrades, or methodology submodule updates exist since `strata-v<productVersion>`, and **stop immediately**.
     - Recommend `<targetVersion>` by SemVer impact (`patch` for bug fixes, tooling, docs, or `resources/strataharness` updates; `minor` for new `StrataHarness` capabilities or upstream `dsh-v*` syncs; `major` for breaking migrations or major milestones; or `X.Y.Z-rc.N` when the user requested a prerelease).
     - Run `pnpm run strata:changelog -- --version <recommendedVersion>` to preview the resolved `baselineTag` (highest prior stable `strata-v*` for stable releases, highest prior any `strata-v*` for prereleases) and draft the Russian product summary for `docs/strata/releases/v<targetVersion>.md` covering `baselineTag..HEAD`.

Preflight is complete when the working tree is clean, `strata:status` and `strata:audit-overrides` passed, zero-change releases are blocked, and `<targetVersion>`, `baselineTag`, `## What's Changed`, and the Russian summary draft are ready.

## 2. Interactive Confirmation 1 — Version & Russian Release Highlights

Before writing any file or Git state, present to the user in Russian:

- Current `productVersion`, `engineVersion` (`upstreamBaseTag`), `methodologyRevision`, and detected mode (Case A unreleased current version without bump vs Case B SemVer increment);
- Recommended `<targetVersion>`, tag `strata-v<targetVersion>`, and comparison `baselineTag`;
- Full proposed Russian product summary for `docs/strata/releases/v<targetVersion>.md` — authored in Russian following [`docs/strata/releases/v1.0.0.md`](../../../docs/strata/releases/v1.0.0.md): leading `# StrataHarness v<targetVersion>`, concise product-focused `###` sections, and **one physical line per paragraph and per list item** (no hard line wraps);
- Rendered `## What's Changed` preview from `pnpm run strata:changelog -- --version <targetVersion>`;
- Numbered options in message text paired with the interactive question tool (`ask_question` / `AskUserQuestion`):
  1. `(Recommended) Утвердить версию v<targetVersion> и русское резюме docs/strata/releases/v<targetVersion>.md (подготовить локальный коммит и тег strata-v<targetVersion>)`
  2. `Изменить целевую версию (patch / minor / major / свой SemVer) или скорректировать текст резюме`
  3. `Отменить подготовку релиза`

Then wait:

- **Option 1** — proceed to Step 3.
- **Option 2** — apply the user's version or summary adjustments, re-run `pnpm run strata:changelog -- --version <targetVersion>` if `<targetVersion>` changed, and re-confirm at Step 2.
- **Option 3** — stop; no files, commits, or tags were created.

Step 2 is complete only when the user explicitly approves `<targetVersion>` and the exact Russian summary text.

## 3. Local Release Preparation (Version Bump, Summary File, Commit & Tag)

Execute in order:

1. **Re-verify tag availability** — check `git tag -l "strata-v<targetVersion>"` and (when `origin` exists) `git ls-remote --tags origin "refs/tags/strata-v<targetVersion>"`. If `strata-v<targetVersion>` exists either locally or on `origin`, **abort immediately** — never delete, move, or force-overwrite an existing release tag.
2. **Optional version bump** — if `<targetVersion>` differs from the current `productVersion` in [`strata-product.json`](../../../strata-product.json), run:
   ```sh
   pnpm run strata:version <targetVersion>
   ```
   ([`scripts/strata/fork-ops.ts`](../../../scripts/strata/fork-ops.ts) updates `strata-product.json` and `packages/strata/*/package.json`). Skip this command when `<targetVersion>` already equals `productVersion` (Case A).
3. **Write Russian product summary** — write `docs/strata/releases/v<targetVersion>.md` (UTF-8, LF line endings, one physical line per paragraph and list item, single trailing newline) unless the file on disk already matches the approved text byte-for-byte.
4. **Verify overrides, strict summary Markdown rules, and whitespace** — run:
   ```sh
   pnpm run strata:audit-overrides
   pnpm run strata:changelog -- --version <targetVersion> --strict-summary
   git diff --check
   ```
   Confirm exit code `0` on all three commands (`--strict-summary` enforces that `docs/strata/releases/v<targetVersion>.md` is non-empty, has one physical line per prose paragraph, and contains zero broken relative Markdown links or anchors) and verify `strata:changelog` prints `Product summary (docs/strata/releases/v<targetVersion>.md): loaded` with zero warnings on `stderr`.
5. **Create local release-prep commit when files changed** — inspect `git status --short`. If any release-prep files changed (`strata-product.json`, `packages/strata/*/package.json`, and/or `docs/strata/releases/v<targetVersion>.md`), stage **only** those explicit paths (`git add -- <explicit-paths>`), verify `git diff --cached --stat`, and create one conventional commit:
   ```sh
   git commit -m "chore(strata): prepare release v<targetVersion>"
   ```
   This subject matches the housekeeping release-prep filter in [`scripts/strata/release-helper.ts`](../../../scripts/strata/release-helper.ts), keeping the bump commit out of `## What's Changed`. If `git status --short` is clean (for example, `1.0.0` and `docs/strata/releases/v1.0.0.md` were already committed unchanged), skip `git commit` and tag `HEAD` directly.
6. **Create annotated release tag and run preflight** — create the annotated tag and validate tag parity:
   ```sh
   git tag -a strata-v<targetVersion> -m "StrataHarness v<targetVersion>"
   pnpm exec tsx scripts/strata/release-helper.ts preflight --git-ref refs/tags/strata-v<targetVersion> --event-name push
   ```

Step 3 is complete when `strata-product.json` equals `<targetVersion>`, `docs/strata/releases/v<targetVersion>.md` is committed and loaded by `strata:changelog`, `git status --short` is clean, annotated tag `strata-v<targetVersion>` points to `HEAD`, and `release-helper.ts preflight` exits `0`.

## 4. Interactive Confirmation 2 — Explicit `git push` Gate

Determine the current branch (`git branch --show-current`, abort if empty / detached `HEAD`), read `upstreamBaseTag` from [`strata-product.json`](../../../strata-product.json), and inspect `git remote get-url origin` (abort if `origin` is missing or points to `deepseek-ai/deepseek-harness`).

Present to the user in Russian:

- Local `HEAD` commit hash and subject (noting whether `chore(strata): prepare release v<targetVersion>` was created or existing `HEAD` was tagged);
- Created annotated tag `strata-v<targetVersion>` and engine base tag `<upstreamBaseTag>`;
- Target remote `origin` URL and branch (`<branch>`, typically `main`);
- Exact atomic push command that publishes `<branch>`, `<upstreamBaseTag>`, and `strata-v<targetVersion>` together (so a rejected branch update never pushes an orphaned release tag, and CI always has `<upstreamBaseTag>`) and triggers [`.github/workflows/strata-release.yml`](../../../.github/workflows/strata-release.yml) on GitHub Actions:
  ```sh
  git push --atomic origin main refs/tags/<upstreamBaseTag>:refs/tags/<upstreamBaseTag> refs/tags/strata-v<targetVersion>:refs/tags/strata-v<targetVersion>
  ```
  (Substitute `<branch>` for `main` only when releasing from another explicitly checked-out release branch.)
- Numbered options in message text paired with `ask_question` / `AskUserQuestion`:
  1. `(Recommended) Отправить main и тег strata-v<targetVersion> в origin (запустить облачную сборку релиза)`
  2. `Оставить коммит и тег только локально (без git push)`

Then wait:

- **Option 1** — run the exact `git push --atomic origin <branch> refs/tags/<upstreamBaseTag>:refs/tags/<upstreamBaseTag> refs/tags/strata-v<targetVersion>:refs/tags/strata-v<targetVersion>` command (never `--force`, never to `upstream`) and report the push result together with instructions to monitor **Actions → Strata Atomic Desktop Release**.
- **Option 2** — do not run `git push`; report the local commit hash, local annotated tag `strata-v<targetVersion>`, and the exact `git push --atomic` command so the user can publish manually when ready.
