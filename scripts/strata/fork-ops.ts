/**
 * Unified Soft-Fork lifecycle CLI for StrataHarness Desktop:
 * dual-track product status, atomic `@strata/*` version bumping, methodology
 * submodule updates, Phase 1–4 isolation auditing, upstream `dsh-v*` release
 * radar impact reports, and sync branch preparation.
 */

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import * as yaml from 'js-yaml'
import semver from 'semver'

const DEFAULT_REPO_ROOT = resolve(import.meta.dirname, '../..')
const PRODUCT_MANIFEST_FILENAME = 'strata-product.json'
const UPSTREAM_TAG_PREFIX = 'dsh-v'

/** Validated fields from the root `strata-product.json` manifest. */
export interface StrataProductManifest {
  /** Human-readable desktop product name. */
  readonly productName: string
  /** Canonical SemVer version for StrataHarness releases and `@strata/*` packages. */
  readonly productVersion: string
  /** Base upstream tag (`dsh-v<semver>`) currently merged into the fork. */
  readonly upstreamBaseTag: string
  /** Canonical upstream Git repository URL. */
  readonly upstreamRepository: string
}

/** Discovered `@strata/*` workspace package manifest summary. */
export interface StrataWorkspacePackage {
  /** Package name declared in `package.json`. */
  readonly name: string
  /** Repository-relative package directory using forward slashes. */
  readonly directory: string
  /** Version string declared in `package.json`. */
  readonly version: string
}

/** Diagnostic snapshot returned by `strata:status`. */
export interface ForkStatusReport {
  /** Product display name from `strata-product.json`. */
  readonly productName: string
  /** Product SemVer from `strata-product.json`. */
  readonly productVersion: string
  /** Bundled DSH engine version from the root `package.json`. */
  readonly engineVersion: string
  /** Upstream base tag from `strata-product.json`. */
  readonly upstreamBaseTag: string
  /** Upstream Git repository URL from `strata-product.json`. */
  readonly upstreamRepository: string
  /** Discovered `packages/strata/*` workspace manifests. */
  readonly strataPackages: readonly StrataWorkspacePackage[]
  /** Described revision or state of `resources/strataharness`. */
  readonly methodologyRevision: string
  /** Count of `strata(override):` commits above `upstreamBaseTag`. */
  readonly overrideCommitCount: number
  /** True when `git status --porcelain` reports zero modified or untracked paths. */
  readonly workingTreeClean: boolean
  /** Number of dirty or untracked paths reported by `git status --porcelain`. */
  readonly dirtyEntriesCount: number
}

/** Options accepted by {@link bumpStrataVersion}. */
export interface BumpStrataVersionOptions {
  /** Repository root directory; defaults to the current monorepo root. */
  readonly repoRoot?: string | undefined
  /** Release increment (`major`, `minor`, `patch`) or explicit canonical SemVer. */
  readonly target: string
  /** Optional replacement `dsh-v<semver>` base tag written to `strata-product.json`. */
  readonly upstreamBaseTag?: string | undefined
}

/** Result returned by {@link bumpStrataVersion}. */
export interface BumpStrataVersionResult {
  /** Previous `productVersion` before the update. */
  readonly previousVersion: string
  /** Updated canonical `productVersion`. */
  readonly productVersion: string
  /** Active `upstreamBaseTag` after the update. */
  readonly upstreamBaseTag: string
  /** Repository-relative manifest paths updated atomically. */
  readonly updatedFiles: readonly string[]
}

/** Options accepted by {@link updateMethodologySubmodule}. */
export interface UpdateMethodologyOptions {
  /** Repository root directory; defaults to the current monorepo root. */
  readonly repoRoot?: string | undefined
  /** Optional Git tag, branch, or ref to check out inside `resources/strataharness`. */
  readonly ref?: string | undefined
  /** Fetch latest refs from `origin` inside `resources/strataharness` before checkout. */
  readonly remote?: boolean | undefined
}

/** Result returned by {@link updateMethodologySubmodule}. */
export interface UpdateMethodologyResult {
  /** Absolute path to `resources/strataharness`. */
  readonly submodulePath: string
  /** Active Git revision or validated directory status after update. */
  readonly revision: string
}

/** Individual invariant check evaluated by {@link auditForkOverrides}. */
export interface AuditOverrideCheck {
  /** Stable check identifier. */
  readonly id: string
  /** True when the invariant holds. */
  readonly ok: boolean
  /** Human-readable verification summary or violation message. */
  readonly detail: string
}

/** Aggregate result returned by {@link auditForkOverrides}. */
export interface AuditOverridesReport {
  /** True when every Phase 1–4 Soft-Fork invariant passes. */
  readonly ok: boolean
  /** Ordered list of invariant checks evaluated. */
  readonly checks: readonly AuditOverrideCheck[]
  /** Human-readable descriptions for every failed check. */
  readonly violations: readonly string[]
}

/** Options accepted by {@link checkUpstreamReleases}. */
export interface CheckUpstreamOptions {
  /** Repository root directory; defaults to the current monorepo root. */
  readonly repoRoot?: string | undefined
  /** Optional explicit upstream Git URL or local repository path. */
  readonly remoteUrl?: string | undefined
  /** Fetch remote `dsh-v*` tag objects locally so `git diff` impact analysis runs. */
  readonly fetch?: boolean | undefined
  /** Inspect local Git tags only without querying a remote repository. */
  readonly local?: boolean | undefined
  /** Bypass the clean-worktree synchronization guard for read-only local inspection. */
  readonly allowDirty?: boolean | undefined
}

/** Structured upstream release radar and merge impact report. */
export interface UpstreamImpactReport {
  /** Product name from `strata-product.json`. */
  readonly productName: string
  /** Current product SemVer from `strata-product.json`. */
  readonly productVersion: string
  /** Current `upstreamBaseTag` from `strata-product.json`. */
  readonly upstreamBaseTag: string
  /** True when no discovered `dsh-v*` tag exceeds `upstreamBaseTag`. */
  readonly upToDate: boolean
  /** Newer `dsh-v*` tags sorted in ascending SemVer order. */
  readonly newerTags: readonly string[]
  /** Highest SemVer `dsh-v*` tag above `upstreamBaseTag`, or `null` when up to date. */
  readonly latestTag: string | null
  /** True when both base and target tag objects exist locally for `git diff` analysis. */
  readonly impactAvailable: boolean
  /** Repository-relative files modified by `strata(override):` commits in `upstreamBaseTag..HEAD`. */
  readonly overrideFiles: readonly string[]
  /** Files modified by both `strata(override):` commits and upstream `upstreamBaseTag..latestTag`. */
  readonly overlappingOverrideFiles: readonly string[]
  /** Added or modified `docs/upgrade-guide/` files in `upstreamBaseTag..latestTag`. */
  readonly upgradeGuides: readonly string[]
  /** Newly added `.github/workflows/*.yml` files in `upstreamBaseTag..latestTag`. */
  readonly newUpstreamWorkflows: readonly string[]
  /** Ready-to-publish Markdown summary suitable for GitHub Issues and step summaries. */
  readonly markdownSummary: string
}

/** Options accepted by {@link prepareUpstreamSync}. */
export interface PrepareUpstreamSyncOptions {
  /** Repository root directory; defaults to the current monorepo root. */
  readonly repoRoot?: string | undefined
  /** Target `dsh-v<semver>` tag to prepare a `sync/<tag>` branch for. */
  readonly targetTag: string
  /** Skip fetching from remote when the target tag object already exists locally. */
  readonly noFetch?: boolean | undefined
  /** Optional explicit upstream Git URL or local repository path for fetching. */
  readonly remoteUrl?: string | undefined
}

/** Result returned by {@link prepareUpstreamSync}. */
export interface PrepareUpstreamSyncResult {
  /** Created Git branch name (`sync/<targetTag>`). */
  readonly branchName: string
  /** Target upstream tag (`dsh-v<semver>`). */
  readonly targetTag: string
  /** Previous upstream base tag from `strata-product.json`. */
  readonly upstreamBaseTag: string
  /** Impact report computed between `upstreamBaseTag` and `targetTag`. */
  readonly impactReport: UpstreamImpactReport
  /** Full Markdown output combining the impact report and 5-step sync checklist. */
  readonly checklistMarkdown: string
}

/** Injectable runtime options for {@link runForkOpsCli}. */
export interface ForkOpsCliOptions {
  /** Repository root directory; defaults to the current monorepo root. */
  readonly repoRoot?: string
  /** Optional stdout sink; defaults to capturing without writing directly. */
  readonly writeStdout?: (chunk: string) => void
  /** Optional stderr sink; defaults to capturing without writing directly. */
  readonly writeStderr?: (chunk: string) => void
}

/** Captured execution result returned by {@link runForkOpsCli}. */
export interface ForkOpsCliResult {
  /** Process exit status (`0` on success, `1` on failure or audit violation). */
  readonly exitCode: number
  /** Captured standard output text. */
  readonly stdout: string
  /** Captured standard error text. */
  readonly stderr: string
}

interface GitResult {
  readonly ok: boolean
  readonly stdout: string
  readonly stderr: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDirectory(targetPath: string): boolean {
  try {
    return statSync(targetPath).isDirectory()
  } catch (_missing) {
    return false
  }
}

function isFile(targetPath: string): boolean {
  try {
    return statSync(targetPath).isFile()
  } catch (_missing) {
    return false
  }
}

function parseJsonRecord(filePath: string): Record<string, unknown> {
  let rawText: string
  try {
    rawText = readFileSync(filePath, 'utf8')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`fork-ops: cannot read ${filePath}: ${detail}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`fork-ops: invalid JSON in ${filePath}: ${detail}`)
  }
  if (!isRecord(parsed)) {
    throw new Error(`fork-ops: ${filePath} must contain a JSON object`)
  }
  return parsed
}

function validateCanonicalSemVer(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`fork-ops: ${label} must be a SemVer string`)
  }
  const parsed = semver.parse(value, { loose: false })
  if (parsed === null) {
    throw new Error(`fork-ops: ${label} ${JSON.stringify(value)} is not a valid SemVer version`)
  }
  if (parsed.build.length > 0) {
    throw new Error(`fork-ops: ${label} ${value} cannot carry build metadata`)
  }
  if (parsed.version !== value) {
    throw new Error(`fork-ops: ${label} ${JSON.stringify(value)} must be canonical SemVer`)
  }
  return parsed.version
}

function validateUpstreamTag(tag: unknown, label: string): string {
  if (typeof tag !== 'string' || !tag.startsWith(UPSTREAM_TAG_PREFIX)) {
    throw new Error(`fork-ops: ${label} ${JSON.stringify(tag)} must start with "${UPSTREAM_TAG_PREFIX}"`)
  }
  validateCanonicalSemVer(tag.slice(UPSTREAM_TAG_PREFIX.length), label)
  return tag
}

function readProductManifest(repoRoot: string): StrataProductManifest {
  const manifestPath = join(repoRoot, PRODUCT_MANIFEST_FILENAME)
  const record = parseJsonRecord(manifestPath)
  if (typeof record.productName !== 'string' || record.productName.trim() === '') {
    throw new Error('fork-ops: strata-product.json productName must be a non-empty string')
  }
  const productVersion = validateCanonicalSemVer(record.productVersion, 'productVersion')
  const upstreamBaseTag = validateUpstreamTag(record.upstreamBaseTag, 'upstreamBaseTag')
  if (typeof record.upstreamRepository !== 'string' || record.upstreamRepository.trim() === '') {
    throw new Error('fork-ops: strata-product.json upstreamRepository must be a non-empty string')
  }
  return {
    productName: record.productName,
    productVersion,
    upstreamBaseTag,
    upstreamRepository: record.upstreamRepository,
  }
}

function readRootEngineVersion(repoRoot: string): string {
  const rootManifest = parseJsonRecord(join(repoRoot, 'package.json'))
  if (typeof rootManifest.version !== 'string' || rootManifest.version.trim() === '') {
    throw new Error('fork-ops: root package.json must declare a non-empty string version')
  }
  return rootManifest.version
}

function discoverStrataPackages(repoRoot: string): StrataWorkspacePackage[] {
  const strataDir = join(repoRoot, 'packages', 'strata')
  if (!isDirectory(strataDir)) {
    return []
  }
  const entries = readdirSync(strataDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right))

  const packages: StrataWorkspacePackage[] = []
  for (const dirName of entries) {
    const manifestPath = join(strataDir, dirName, 'package.json')
    if (!isFile(manifestPath)) continue
    const record = parseJsonRecord(manifestPath)
    if (typeof record.name !== 'string' || typeof record.version !== 'string') {
      throw new Error(`fork-ops: packages/strata/${dirName}/package.json must declare string name and version`)
    }
    packages.push({
      name: record.name,
      directory: `packages/strata/${dirName}`,
      version: record.version,
    })
  }
  return packages
}

function tryGit(cwd: string, args: readonly string[]): GitResult {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  const ok = result.status === 0 && result.error === undefined
  return {
    ok,
    stdout: result.error !== undefined ? '' : result.stdout.trimEnd(),
    stderr: result.error !== undefined ? '' : result.stderr.trimEnd(),
  }
}

function runGitOrThrow(cwd: string, args: readonly string[], action: string): string {
  const result = tryGit(cwd, args)
  if (!result.ok) {
    const detail = result.stderr !== '' ? result.stderr : result.stdout
    throw new Error(`fork-ops: failed to ${action}: ${detail || `git ${args.join(' ')} exited non-zero`}`)
  }
  return result.stdout
}

function verifyMethodologyEntrypoints(submodulePath: string): string | null {
  if (!isDirectory(submodulePath)) {
    return 'resources/strataharness directory does not exist'
  }
  if (!isDirectory(join(submodulePath, '.agents', 'skills'))) {
    return 'resources/strataharness is missing required entrypoint directory .agents/skills'
  }
  if (!isFile(join(submodulePath, 'AGENTS.md')) && !isFile(join(submodulePath, 'README.md'))) {
    return 'resources/strataharness is missing required entrypoint file AGENTS.md or README.md'
  }
  return null
}

function gitRefExists(repoRoot: string, refExpression: string): boolean {
  return tryGit(repoRoot, ['rev-parse', '--verify', '--quiet', refExpression]).ok
}

function describeMethodologyRevision(repoRoot: string): string {
  const submodulePath = join(repoRoot, 'resources', 'strataharness')
  if (!isDirectory(submodulePath)) {
    return 'missing'
  }
  if (existsSync(join(submodulePath, '.git'))) {
    const described = tryGit(submodulePath, ['describe', '--tags', '--always', '--dirty'])
    if (described.ok && described.stdout.trim() !== '') {
      return described.stdout.trim()
    }
  }
  const versionPath = join(submodulePath, 'VERSION')
  if (isFile(versionPath)) {
    const text = readFileSync(versionPath, 'utf8').trim()
    if (text !== '') return `v${text.replace(/^v/u, '')}`
  }
  if (isDirectory(join(submodulePath, '.agents', 'skills'))) {
    return 'present (untracked-git)'
  }
  return 'empty'
}

function atomicWriteFiles(writes: ReadonlyArray<{ readonly filePath: string; readonly content: string }>): void {
  const staged: Array<{ readonly tempPath: string; readonly filePath: string }> = []
  try {
    for (const [index, entry] of writes.entries()) {
      const tempPath = join(
        dirname(entry.filePath),
        `.${basename(entry.filePath)}.tmp-${String(process.pid)}-${String(index)}`,
      )
      writeFileSync(tempPath, entry.content, 'utf8')
      staged.push({ tempPath, filePath: entry.filePath })
    }
    for (const entry of staged) {
      renameSync(entry.tempPath, entry.filePath)
    }
  } catch (error) {
    for (const entry of staged) {
      rmSync(entry.tempPath, { force: true })
    }
    throw error
  }
}

function formatStatusHuman(report: ForkStatusReport): string {
  const lines = [
    `Product: ${report.productName} ${report.productVersion}`,
    `Engine: DSH ${report.engineVersion} (base tag: ${report.upstreamBaseTag})`,
    `Upstream repository: ${report.upstreamRepository}`,
    `Methodology submodule: ${report.methodologyRevision}`,
    `Override commits (${report.upstreamBaseTag}..HEAD): ${String(report.overrideCommitCount)}`,
    `Working tree: ${report.workingTreeClean ? 'clean' : `dirty (${String(report.dirtyEntriesCount)} paths)`}`,
    '@strata/* packages:',
    ...report.strataPackages.map(pkg => `  - ${pkg.name}@${pkg.version} (${pkg.directory})`),
  ]
  return `${lines.join('\n')}\n`
}

/**
 * Inspect dual-track product/engine versions, `@strata/*` manifests, submodule revision, and `strata(override)` commit count.
 * @param repoRoot - Repository root directory to inspect.
 * @returns Structured Soft-Fork status report.
 */
export function getForkStatus(repoRoot: string = DEFAULT_REPO_ROOT): ForkStatusReport {
  const manifest = readProductManifest(repoRoot)
  const engineVersion = readRootEngineVersion(repoRoot)
  const strataPackages = discoverStrataPackages(repoRoot)
  const methodologyRevision = describeMethodologyRevision(repoRoot)

  let overrideCommitCount = 0
  if (gitRefExists(repoRoot, `${manifest.upstreamBaseTag}^{commit}`)) {
    const logResult = tryGit(repoRoot, [
      'log',
      `${manifest.upstreamBaseTag}..HEAD`,
      '--basic-regexp',
      '--grep=^strata(override):',
      '--pretty=format:%s',
    ])
    if (logResult.ok && logResult.stdout.trim() !== '') {
      overrideCommitCount = logResult.stdout.split('\n').filter(line => line.trim() !== '').length
    }
  }

  const porcelain = tryGit(repoRoot, ['status', '--porcelain'])
  const dirtyLines = porcelain.ok && porcelain.stdout.trim() !== ''
    ? porcelain.stdout.split('\n').filter(line => line.trim() !== '')
    : []

  return {
    productName: manifest.productName,
    productVersion: manifest.productVersion,
    engineVersion,
    upstreamBaseTag: manifest.upstreamBaseTag,
    upstreamRepository: manifest.upstreamRepository,
    strataPackages,
    methodologyRevision,
    overrideCommitCount,
    workingTreeClean: dirtyLines.length === 0,
    dirtyEntriesCount: dirtyLines.length,
  }
}

/**
 * Atomically update `productVersion` (and optionally `upstreamBaseTag`) across `strata-product.json` and `packages/strata/*`.
 * @param options - Version target, optional upstream base tag, and repository root.
 * @returns Summary of the version transition and updated manifest paths.
 */
export function bumpStrataVersion(options: BumpStrataVersionOptions): BumpStrataVersionResult {
  const repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT
  const manifest = readProductManifest(repoRoot)
  const target = options.target.trim()

  let nextVersion: string
  if (target === 'major' || target === 'minor' || target === 'patch') {
    const incremented = semver.inc(manifest.productVersion, target)
    if (incremented === null) {
      throw new Error(`fork-ops: cannot increment ${manifest.productVersion} by ${target}`)
    }
    nextVersion = validateCanonicalSemVer(incremented, 'version')
  } else {
    nextVersion = validateCanonicalSemVer(target, 'version')
  }

  const nextUpstreamBaseTag = options.upstreamBaseTag !== undefined
    ? validateUpstreamTag(options.upstreamBaseTag, 'upstreamBaseTag')
    : manifest.upstreamBaseTag

  const strataPackages = discoverStrataPackages(repoRoot)
  if (strataPackages.length === 0) {
    throw new Error('fork-ops: no packages/strata/*/package.json manifests found')
  }

  const updatedProductManifest: StrataProductManifest = {
    productName: manifest.productName,
    productVersion: nextVersion,
    upstreamBaseTag: nextUpstreamBaseTag,
    upstreamRepository: manifest.upstreamRepository,
  }

  const writes: Array<{ readonly filePath: string; readonly content: string }> = [
    {
      filePath: join(repoRoot, PRODUCT_MANIFEST_FILENAME),
      content: `${JSON.stringify(updatedProductManifest, null, 2)}\n`,
    },
  ]
  const updatedFiles: string[] = [PRODUCT_MANIFEST_FILENAME]

  for (const pkg of strataPackages) {
    const manifestRelativePath = `${pkg.directory}/package.json`
    const manifestFullPath = join(repoRoot, manifestRelativePath)
    const rawRecord = parseJsonRecord(manifestFullPath)
    const nextRecord: Record<string, unknown> = {
      ...rawRecord,
      version: nextVersion,
    }
    writes.push({
      filePath: manifestFullPath,
      content: `${JSON.stringify(nextRecord, null, 2)}\n`,
    })
    updatedFiles.push(manifestRelativePath)
  }

  atomicWriteFiles(writes)

  return {
    previousVersion: manifest.productVersion,
    productVersion: nextVersion,
    upstreamBaseTag: nextUpstreamBaseTag,
    updatedFiles,
  }
}

/**
 * Update or validate the `resources/strataharness` methodology submodule and verify its required skill entrypoints.
 * @param options - Optional target ref, remote fetch flag, and repository root.
 * @returns Validated submodule path and active revision string.
 */
export function updateMethodologySubmodule(options: UpdateMethodologyOptions = {}): UpdateMethodologyResult {
  const repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT
  const submodulePath = join(repoRoot, 'resources', 'strataharness')
  if (!isDirectory(submodulePath)) {
    throw new Error(`fork-ops: resources/strataharness directory not found at ${submodulePath}`)
  }

  const ref = options.ref?.trim()
  if (options.ref !== undefined && (ref === undefined || ref === '')) {
    throw new Error('fork-ops: update-methodology --ref requires a non-empty Git tag or branch')
  }

  if (options.remote === true || ref !== undefined) {
    if (!existsSync(join(submodulePath, '.git'))) {
      throw new Error('fork-ops: resources/strataharness is not an initialized Git submodule or repository')
    }
    if (options.remote === true) {
      runGitOrThrow(submodulePath, ['fetch', '--tags', '--force', 'origin'], 'fetch methodology origin')
      if (ref === undefined) {
        const pulled = tryGit(submodulePath, ['pull', '--ff-only'])
        if (!pulled.ok) {
          runGitOrThrow(submodulePath, ['checkout', 'origin/HEAD'], 'checkout methodology origin/HEAD')
        }
      }
    }
    if (ref !== undefined) {
      runGitOrThrow(submodulePath, ['checkout', ref], `checkout methodology ref ${ref}`)
    }
  }

  const entrypointError = verifyMethodologyEntrypoints(submodulePath)
  if (entrypointError !== null) {
    throw new Error(`fork-ops: ${entrypointError}`)
  }

  return {
    submodulePath,
    revision: describeMethodologyRevision(repoRoot),
  }
}

function formatAuditHuman(report: AuditOverridesReport): string {
  const lines = [
    `Soft-Fork override audit: ${report.ok ? 'PASS' : 'FAIL'}`,
    ...report.checks.map(check => `  [${check.ok ? 'PASS' : 'FAIL'}] ${check.id}: ${check.detail}`),
  ]
  return `${lines.join('\n')}\n`
}

/**
 * Audit all Phase 1–4 Soft-Fork isolation, version parity, submodule, and `.github/` workflow/Dependabot hygiene invariants.
 * @param repoRoot - Repository root directory to audit.
 * @returns Audit report listing every evaluated invariant and any violations.
 */
export function auditForkOverrides(repoRoot: string = DEFAULT_REPO_ROOT): AuditOverridesReport {
  const checks: AuditOverrideCheck[] = []

  // (a) Product manifest & @strata/* version parity
  try {
    const manifest = readProductManifest(repoRoot)
    const strataPackages = discoverStrataPackages(repoRoot)
    const parityFailures: string[] = []
    if (manifest.productName !== 'StrataHarness') {
      parityFailures.push(`strata-product.json productName expected "StrataHarness", got ${JSON.stringify(manifest.productName)}`)
    }
    if (strataPackages.length === 0) {
      parityFailures.push('no packages/strata/*/package.json manifests found')
    }
    for (const pkg of strataPackages) {
      if (pkg.version !== manifest.productVersion) {
        parityFailures.push(
          `${pkg.name} (${pkg.directory}/package.json) version ${pkg.version} !== strata-product.json ${manifest.productVersion}`,
        )
      }
    }
    checks.push({
      id: 'product-version-parity',
      ok: parityFailures.length === 0,
      detail: parityFailures.length === 0
        ? `strata-product.json and ${String(strataPackages.length)} @strata/* package(s) match ${manifest.productVersion}`
        : parityFailures.join('; '),
    })
  } catch (error) {
    checks.push({
      id: 'product-version-parity',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  // (b) Phase 1 @strata/product-bundle wiring
  {
    const bundleFailures: string[] = []
    const bundleManifestPath = join(repoRoot, 'packages', 'strata', 'product-bundle', 'package.json')
    if (!isFile(bundleManifestPath)) {
      bundleFailures.push('packages/strata/product-bundle/package.json is missing')
    } else {
      try {
        const bundleManifest = parseJsonRecord(bundleManifestPath)
        if (bundleManifest.name !== '@strata/product-bundle') {
          bundleFailures.push('packages/strata/product-bundle/package.json must declare name "@strata/product-bundle"')
        }
      } catch (error) {
        bundleFailures.push(error instanceof Error ? error.message : String(error))
      }
    }

    for (const wiringRelPath of ['packages/boot/app-boot/src/profile.ts', 'apps/desktop/src/project-manager.ts']) {
      const fullPath = join(repoRoot, wiringRelPath)
      if (!isFile(fullPath)) {
        bundleFailures.push(`${wiringRelPath} is missing`)
      } else {
        const text = readFileSync(fullPath, 'utf8')
        if (!text.includes('@strata/product-bundle')) {
          bundleFailures.push(`${wiringRelPath} does not wire @strata/product-bundle`)
        }
      }
    }

    checks.push({
      id: 'product-bundle-wiring',
      ok: bundleFailures.length === 0,
      detail: bundleFailures.length === 0
        ? '@strata/product-bundle is present and wired into web and desktop profiles'
        : bundleFailures.join('; '),
    })
  }

  // (b2) @strata/locale-ru package, dependency, and default-locale overlay wiring
  {
    const localeFailures: string[] = []
    let expectedProductVersion: string | undefined
    try {
      expectedProductVersion = readProductManifest(repoRoot).productVersion
    } catch (_manifestErr) {
      expectedProductVersion = undefined
    }

    const localeManifestPath = join(repoRoot, 'packages', 'strata', 'locale-ru', 'package.json')
    if (!isFile(localeManifestPath)) {
      localeFailures.push('packages/strata/locale-ru/package.json is missing')
    } else {
      try {
        const localeManifest = parseJsonRecord(localeManifestPath)
        if (localeManifest.name !== '@strata/locale-ru') {
          localeFailures.push('packages/strata/locale-ru/package.json must declare name "@strata/locale-ru"')
        }
        if (expectedProductVersion !== undefined && localeManifest.version !== expectedProductVersion) {
          localeFailures.push(
            `packages/strata/locale-ru/package.json version ${String(localeManifest.version)} !== strata-product.json ${expectedProductVersion}`,
          )
        }
      } catch (error) {
        localeFailures.push(error instanceof Error ? error.message : String(error))
      }
    }

    const bundleManifestPath = join(repoRoot, 'packages', 'strata', 'product-bundle', 'package.json')
    if (isFile(bundleManifestPath)) {
      try {
        const bundleManifest = parseJsonRecord(bundleManifestPath)
        const dependencies = isRecord(bundleManifest.dependencies) ? bundleManifest.dependencies : undefined
        if (typeof dependencies?.['@strata/locale-ru'] !== 'string' || dependencies['@strata/locale-ru'].trim() === '') {
          localeFailures.push('packages/strata/product-bundle/package.json must declare "@strata/locale-ru" in dependencies')
        }
      } catch (error) {
        localeFailures.push(error instanceof Error ? error.message : String(error))
      }
    }

    const patchPath = join(repoRoot, 'packages', 'strata', 'product-bundle', 'cordis.patch.yml')
    if (!isFile(patchPath)) {
      localeFailures.push('packages/strata/product-bundle/cordis.patch.yml is missing')
    } else {
      try {
        const parsedPatch: unknown = yaml.load(readFileSync(patchPath, 'utf8'))
        if (!Array.isArray(parsedPatch)) {
          localeFailures.push('packages/strata/product-bundle/cordis.patch.yml must parse to a YAML sequence')
        } else {
          let mountsLocaleRu = false
          let defaultLocale: unknown
          let localeOrder: unknown
          for (const entry of parsedPatch) {
            if (!isRecord(entry)) continue
            if (entry.id === 'locale' && isRecord(entry.config)) {
              defaultLocale = entry.config.defaultLocale
              localeOrder = entry.config.localeOrder
            }
            if (Array.isArray(entry.insert)) {
              for (const child of entry.insert) {
                if (isRecord(child) && child.name === '@strata/locale-ru') {
                  mountsLocaleRu = true
                }
              }
            }
          }
          if (!mountsLocaleRu) {
            localeFailures.push('packages/strata/product-bundle/cordis.patch.yml does not insert "@strata/locale-ru"')
          }
          if (defaultLocale !== 'ru') {
            localeFailures.push(
              `packages/strata/product-bundle/cordis.patch.yml must configure locale defaultLocale: "ru", got ${JSON.stringify(defaultLocale)}`,
            )
          }
          const validOrder = Array.isArray(localeOrder)
            && localeOrder.length === 3
            && localeOrder[0] === 'ru'
            && localeOrder[1] === 'en'
            && localeOrder[2] === 'zh'
          if (!validOrder) {
            localeFailures.push(
              `packages/strata/product-bundle/cordis.patch.yml must configure localeOrder: ["ru", "en", "zh"], got ${JSON.stringify(localeOrder)}`,
            )
          }
        }
      } catch (error) {
        localeFailures.push(error instanceof Error ? error.message : String(error))
      }
    }

    checks.push({
      id: 'russian-locale-pack',
      ok: localeFailures.length === 0,
      detail: localeFailures.length === 0
        ? '@strata/locale-ru is present, version-aligned, declared in @strata/product-bundle, and mounted with defaultLocale: ru and localeOrder: [ru, en, zh]'
        : localeFailures.join('; '),
    })
  }

  // (c) Phase 3 three-level desktop isolation
  {
    const isolationFailures: string[] = []
    const desktopConfigPath = join(repoRoot, 'apps', 'desktop', 'scripts', 'strata-desktop-config.mjs')
    if (!isFile(desktopConfigPath)) {
      isolationFailures.push('apps/desktop/scripts/strata-desktop-config.mjs is missing')
    } else {
      const configText = readFileSync(desktopConfigPath, 'utf8')
      if (!/STRATA_DESKTOP_APP_ID\s*=\s*['"]com\.nikl\.strataharness['"]/u.test(configText)) {
        isolationFailures.push('STRATA_DESKTOP_APP_ID must equal "com.nikl.strataharness"')
      }
      if (!/STRATA_DESKTOP_PACKAGE_NAME\s*=\s*['"]@strata\/desktop['"]/u.test(configText)) {
        isolationFailures.push('STRATA_DESKTOP_PACKAGE_NAME must equal "@strata/desktop"')
      }
      if (!/STRATA_DESKTOP_URL_SCHEME\s*=\s*['"]strata['"]/u.test(configText)) {
        isolationFailures.push('STRATA_DESKTOP_URL_SCHEME must equal "strata"')
      }
      if (!/STRATA_PRODUCTION_UPDATE_FIXED_ORIGIN\s*=\s*undefined\b/u.test(configText)) {
        isolationFailures.push('STRATA_PRODUCTION_UPDATE_FIXED_ORIGIN must remain undefined (no upstream CDN fallback)')
      }
      if (!/BLOCKED_UPSTREAM_UPDATE_ORIGINS[\s\S]*https:\/\/download\.deepseek\.com/u.test(configText)) {
        isolationFailures.push('BLOCKED_UPSTREAM_UPDATE_ORIGINS must block https://download.deepseek.com')
      }
    }

    const desktopPathsFile = join(repoRoot, 'apps', 'desktop', 'src', 'paths.ts')
    if (!isFile(desktopPathsFile)) {
      isolationFailures.push('apps/desktop/src/paths.ts is missing')
    } else {
      const pathsText = readFileSync(desktopPathsFile, 'utf8')
      if (!/STRATA_HOME_DIR_NAME\s*=\s*['"]\.strataharness['"]/u.test(pathsText)) {
        isolationFailures.push('apps/desktop/src/paths.ts must isolate STRATA_HOME_DIR_NAME to ".strataharness"')
      }
    }

    checks.push({
      id: 'desktop-three-level-isolation',
      ok: isolationFailures.length === 0,
      detail: isolationFailures.length === 0
        ? 'com.nikl.strataharness, @strata/desktop, ~/.strataharness, strata://, and download.deepseek.com block verified'
        : isolationFailures.join('; '),
    })
  }

  // (d) Bundled methodology submodule non-empty
  {
    const submodulePath = join(repoRoot, 'resources', 'strataharness')
    const entrypointError = verifyMethodologyEntrypoints(submodulePath)
    checks.push({
      id: 'methodology-submodule',
      ok: entrypointError === null,
      detail: entrypointError === null
        ? `resources/strataharness verified (${describeMethodologyRevision(repoRoot)})`
        : entrypointError,
    })
  }

  // (e) Active GitHub Actions workflow and Dependabot hygiene
  {
    const githubDir = join(repoRoot, '.github')
    const workflowsDir = join(githubDir, 'workflows')
    const archivedDependabotPath = join(githubDir, 'upstream-workflows', 'dependabot.yml')
    const workflowPattern = /^strata-[a-z0-9-]+\.yml$/u
    const activeDependabotEntries = isDirectory(githubDir)
      ? readdirSync(githubDir)
        .filter(name => /^dependabot\.ya?ml$/iu.test(name))
        .sort((left, right) => left.localeCompare(right))
        .map(name => `.github/${name}`)
      : []
    const hygieneErrors: string[] = []
    let validFiles: string[] = []
    if (!isDirectory(workflowsDir)) {
      hygieneErrors.push('.github/workflows directory is missing')
    } else {
      const entries = readdirSync(workflowsDir, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name))
      validFiles = entries.filter(entry => entry.isFile() && workflowPattern.test(entry.name)).map(entry => entry.name)
      const invalidEntries = entries.filter(entry => !entry.isFile() || !workflowPattern.test(entry.name)).map(entry => entry.name)
      if (invalidEntries.length > 0) {
        hygieneErrors.push(`.github/workflows contains non-Strata entries: ${invalidEntries.join(', ')} (only strata-*.yml allowed)`)
      } else if (validFiles.length === 0) {
        hygieneErrors.push('.github/workflows contains zero strata-*.yml workflow files')
      }
    }
    if (activeDependabotEntries.length > 0) {
      hygieneErrors.push(
        `${activeDependabotEntries.join(', ')} must be relocated to .github/upstream-workflows/ in Soft-Fork mode`,
      )
    }
    if (!isFile(archivedDependabotPath)) {
      hygieneErrors.push('.github/upstream-workflows/dependabot.yml archive is missing (preserve 100% git mv rename tracking)')
    }
    checks.push({
      id: 'workflow-directory-hygiene',
      ok: hygieneErrors.length === 0,
      detail: hygieneErrors.length > 0
        ? hygieneErrors.join('; ')
        : `.github/workflows contains ${String(validFiles.length)} valid strata-*.yml workflow(s): ${validFiles.join(', ')}; active .github/dependabot.{yml,yaml} absent and archived under .github/upstream-workflows/dependabot.yml`,
    })
  }

  const violations = checks.filter(check => !check.ok).map(check => `${check.id}: ${check.detail}`)
  return {
    ok: violations.length === 0,
    checks,
    violations,
  }
}

function uniqueSortedPaths(rawOutput: string): string[] {
  if (rawOutput.trim() === '') return []
  const unique = new Set<string>()
  for (const line of rawOutput.split('\n')) {
    const normalized = line.trim().replaceAll('\\', '/')
    if (normalized !== '') unique.add(normalized)
  }
  return [...unique].sort((left, right) => left.localeCompare(right))
}

function validateUpstreamRemoteTarget(repoRoot: string, candidate: string, label: string): string {
  const trimmed = candidate.trim()
  if (trimmed === '') {
    throw new Error(`fork-ops: ${label} must not be empty`)
  }
  if (trimmed.startsWith('-')) {
    throw new Error(`fork-ops: ${label} ${JSON.stringify(trimmed)} must not start with "-"`)
  }
  if (/[\u0000-\u001f\u007f]/u.test(trimmed)) {
    throw new Error(`fork-ops: ${label} must not contain control characters`)
  }
  const localCandidate = resolve(repoRoot, trimmed)
  if (isDirectory(localCandidate)) {
    return localCandidate
  }
  if (/\s/u.test(trimmed)) {
    throw new Error(`fork-ops: ${label} ${JSON.stringify(trimmed)} must not contain whitespace`)
  }
  if (/^(?:https|ssh|file):\/\/[^\s]+$/u.test(trimmed) || /^git@[A-Za-z0-9.-]+:[A-Za-z0-9._/-]+$/u.test(trimmed)) {
    return trimmed
  }
  if (/^[A-Za-z0-9._-]+$/u.test(trimmed) && tryGit(repoRoot, ['remote', 'get-url', trimmed]).ok) {
    return trimmed
  }
  throw new Error(
    `fork-ops: ${label} ${JSON.stringify(trimmed)} must be an https://, ssh://, file://, git@host:path URL, configured Git remote, or existing local directory`,
  )
}

function resolveUpstreamRemoteTarget(
  repoRoot: string,
  manifest: StrataProductManifest,
  explicitRemoteUrl?: string,
): string {
  const trimmed = explicitRemoteUrl?.trim()
  if (trimmed !== undefined && trimmed !== '') {
    return validateUpstreamRemoteTarget(repoRoot, trimmed, 'remoteUrl')
  }
  if (tryGit(repoRoot, ['remote', 'get-url', 'upstream']).ok) {
    return 'upstream'
  }
  return validateUpstreamRemoteTarget(repoRoot, manifest.upstreamRepository, 'upstreamRepository')
}

function filterAndSortNewerUpstreamTags(candidateTags: Iterable<string>, upstreamBaseTag: string): string[] {
  const baseVersion = validateCanonicalSemVer(
    upstreamBaseTag.slice(UPSTREAM_TAG_PREFIX.length),
    'upstreamBaseTag',
  )
  const newerVersions = new Map<string, string>()
  for (const rawTag of candidateTags) {
    const tag = rawTag.trim()
    if (!tag.startsWith(UPSTREAM_TAG_PREFIX) || tag.endsWith('^{}')) continue
    const suffix = tag.slice(UPSTREAM_TAG_PREFIX.length)
    const parsed = semver.parse(suffix, { loose: false })
    if (parsed === null || parsed.build.length > 0 || parsed.version !== suffix) continue
    if (semver.gt(parsed.version, baseVersion)) {
      newerVersions.set(parsed.version, tag)
    }
  }
  return [...newerVersions.entries()]
    .sort(([leftVer], [rightVer]) => semver.compare(leftVer, rightVer))
    .map(([, tag]) => tag)
}

function collectOverrideTouchedFiles(repoRoot: string, upstreamBaseTag: string): string[] {
  if (!gitRefExists(repoRoot, `${upstreamBaseTag}^{commit}`)) {
    return []
  }
  const logOut = tryGit(repoRoot, [
    'log',
    '--diff-merges=first-parent',
    `${upstreamBaseTag}..HEAD`,
    '--basic-regexp',
    '--grep=^strata(override):',
    '--name-only',
    '--pretty=format:',
  ])
  return logOut.ok ? uniqueSortedPaths(logOut.stdout) : []
}

function renderMarkdownBullets(items: readonly string[]): string {
  if (items.length === 0) return '- _(none)_'
  return items.map(item => `- \`${item}\``).join('\n')
}

function buildUpstreamImpactReport(
  repoRoot: string,
  manifest: StrataProductManifest,
  newerTags: readonly string[],
  targetTag: string | null,
): UpstreamImpactReport {
  const upToDate = targetTag === null
  const overrideFiles = collectOverrideTouchedFiles(repoRoot, manifest.upstreamBaseTag)

  let impactAvailable = false
  let overlappingOverrideFiles: string[] = []
  let upgradeGuides: string[] = []
  let newUpstreamWorkflows: string[] = []

  if (
    targetTag !== null
    && gitRefExists(repoRoot, `${manifest.upstreamBaseTag}^{commit}`)
    && gitRefExists(repoRoot, `${targetTag}^{commit}`)
  ) {
    impactAvailable = true
    const changedFiles = uniqueSortedPaths(
      runGitOrThrow(
        repoRoot,
        ['diff', '--name-only', `${manifest.upstreamBaseTag}...${targetTag}`],
        `diff ${manifest.upstreamBaseTag}...${targetTag}`,
      ),
    )
    const changedSet = new Set(changedFiles)
    overlappingOverrideFiles = overrideFiles.filter(file => changedSet.has(file))

    upgradeGuides = uniqueSortedPaths(
      runGitOrThrow(
        repoRoot,
        ['diff', '--diff-filter=ACMR', '--name-only', `${manifest.upstreamBaseTag}...${targetTag}`, '--', 'docs/upgrade-guide/'],
        `diff docs/upgrade-guide/ in ${manifest.upstreamBaseTag}...${targetTag}`,
      ),
    )

    newUpstreamWorkflows = uniqueSortedPaths(
      runGitOrThrow(
        repoRoot,
        [
          'diff',
          '--diff-filter=A',
          '--name-only',
          `${manifest.upstreamBaseTag}...${targetTag}`,
          '--',
          '.github/workflows/',
          '.github/dependabot.yml',
          '.github/dependabot.yaml',
        ],
        `diff added workflows and dependabot config in ${manifest.upstreamBaseTag}...${targetTag}`,
      ),
    ).filter(path => path.endsWith('.yml') || path.endsWith('.yaml'))
  }

  const markdownLines: string[] = [
    `## Upstream Release Radar — ${manifest.productName} ${manifest.productVersion}`,
    '',
    `- **Current upstream base tag:** \`${manifest.upstreamBaseTag}\``,
    `- **Status:** ${upToDate ? 'Up to date' : `Update available (\`${targetTag}\`)`}`,
  ]

  if (targetTag !== null) {
    markdownLines.push(
      `- **Newer upstream tags (${String(newerTags.length)}):** ${newerTags.map(tag => `\`${tag}\``).join(', ')}`,
      `- **Git diff impact analysis:** ${impactAvailable ? 'available' : 'unavailable (run with `--fetch` to inspect Git objects)'}`,
      '',
      `### Overlapping \`strata(override)\` files (${String(overlappingOverrideFiles.length)})`,
      '',
      renderMarkdownBullets(overlappingOverrideFiles),
      '',
      `### Upstream \`docs/upgrade-guide/\` entries (${String(upgradeGuides.length)})`,
      '',
      renderMarkdownBullets(upgradeGuides),
      '',
      `### Newly added upstream \`.github/workflows/*.yml\` files (${String(newUpstreamWorkflows.length)})`,
      '',
      renderMarkdownBullets(newUpstreamWorkflows),
      '',
      '### Next step',
      '',
      '```sh',
      `pnpm run strata:prepare-upstream-sync ${targetTag}`,
      '```',
    )
  }

  return {
    productName: manifest.productName,
    productVersion: manifest.productVersion,
    upstreamBaseTag: manifest.upstreamBaseTag,
    upToDate,
    newerTags: [...newerTags],
    latestTag: targetTag,
    impactAvailable,
    overrideFiles,
    overlappingOverrideFiles,
    upgradeGuides,
    newUpstreamWorkflows,
    markdownSummary: markdownLines.join('\n'),
  }
}

/**
 * Compare `upstreamBaseTag` against available `dsh-v*` tags and compute the merge impact report.
 * @param options - Remote/local tag discovery options, fetch toggle, and repository root.
 * @returns Structured upstream release radar and impact report.
 */
export function checkUpstreamReleases(options: CheckUpstreamOptions = {}): UpstreamImpactReport {
  const repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT
  const manifest = readProductManifest(repoRoot)

  if (options.allowDirty !== true) {
    const porcelain = runGitOrThrow(repoRoot, ['status', '--porcelain'], 'check Git working tree cleanliness')
    if (porcelain.trim() !== '') {
      throw new Error(
        'fork-ops: check-upstream blocked because the Git working tree has dirty/uncommitted changes; '
        + 'commit or stash all modifications before starting upstream sync checks (or pass --allow-dirty for read-only inspection)',
      )
    }
  }

  let candidateTags: string[]
  let remoteTarget: string | undefined
  if (options.local === true) {
    const localOut = runGitOrThrow(repoRoot, ['tag', '--list', `${UPSTREAM_TAG_PREFIX}*`], 'list local dsh-v* tags')
    candidateTags = localOut === '' ? [] : localOut.split('\n')
  } else {
    remoteTarget = resolveUpstreamRemoteTarget(repoRoot, manifest, options.remoteUrl)
    const lsOut = runGitOrThrow(
      repoRoot,
      ['ls-remote', '--tags', '--refs', remoteTarget, `refs/tags/${UPSTREAM_TAG_PREFIX}*`],
      `query remote tags from ${remoteTarget}`,
    )
    candidateTags = lsOut === ''
      ? []
      : lsOut
        .split('\n')
        .map(line => line.split('\t')[1] ?? '')
        .filter(ref => ref.startsWith('refs/tags/'))
        .map(ref => ref.slice('refs/tags/'.length))
  }

  const newerTags = filterAndSortNewerUpstreamTags(candidateTags, manifest.upstreamBaseTag)
  const latestTag = newerTags.at(-1) ?? null

  if (options.fetch === true && options.local !== true && remoteTarget !== undefined && latestTag !== null) {
    const refspecs = newerTags.map(tag => `refs/tags/${tag}:refs/tags/${tag}`)
    if (!gitRefExists(repoRoot, `${manifest.upstreamBaseTag}^{commit}`)) {
      refspecs.push(`refs/tags/${manifest.upstreamBaseTag}:refs/tags/${manifest.upstreamBaseTag}`)
    }
    runGitOrThrow(
      repoRoot,
      ['fetch', '--no-recurse-submodules', '--force', remoteTarget, ...refspecs],
      `fetch newer dsh-v* tags from ${remoteTarget}`,
    )
  }

  return buildUpstreamImpactReport(repoRoot, manifest, newerTags, latestTag)
}

function renderFiveStepChecklist(targetTag: string, impactMarkdown: string): string {
  return [
    impactMarkdown,
    '',
    `## 5-Step Soft-Fork Synchronization Checklist (\`${targetTag}\`)`,
    '',
    `1. **Merge without auto-commit:** run \`git merge --no-commit ${targetTag}\` and resolve any overlapping \`strata(override)\` files while preserving override markers.`,
    '2. **Isolate new workflows & review upgrade guides:** relocate any newly added `.github/workflows/*.yml` or `.github/dependabot.{yml,yaml}` files via `git mv` into `.github/upstream-workflows/` and review all listed `docs/upgrade-guide/` entries.',
    '3. **Verify Soft-Fork invariants, Russian localization parity, & workspace constraints:** run `pnpm run strata:audit-overrides`, `pnpm exec vitest run scripts/strata/russian-localization-parity.spec.ts`, `pnpm run constraints`, and targeted regression suites.',
    `4. **Advance dual-track product version:** run \`pnpm run strata:version minor --upstream-base ${targetTag}\` to bump \`strata-product.json\` and \`@strata/*\` atomically.`,
    '5. **Qualify packaged desktop & local updater:** run `pnpm --filter @deepseek-ai/dsh-desktop run check:package` and `pnpm --filter @deepseek-ai/dsh-desktop run test:updates:local`.',
    '',
  ].join('\n')
}

/**
 * Require a clean Git working tree, fetch the target `dsh-v*` tag, create branch `sync/<tag>`, and render the 5-step sync checklist.
 * @param options - Target `dsh-v*` tag, fetch options, and repository root.
 * @returns Created sync branch metadata, impact report, and Markdown checklist.
 */
export function prepareUpstreamSync(options: PrepareUpstreamSyncOptions): PrepareUpstreamSyncResult {
  const repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT
  const targetTag = validateUpstreamTag(options.targetTag.trim(), 'targetTag')
  const manifest = readProductManifest(repoRoot)

  const porcelain = runGitOrThrow(repoRoot, ['status', '--porcelain'], 'check Git working tree cleanliness')
  if (porcelain.trim() !== '') {
    throw new Error(
      'fork-ops: prepare-upstream-sync blocked because the Git working tree has dirty/uncommitted changes; '
      + 'commit or stash all modifications before starting an upstream sync',
    )
  }

  if (options.noFetch !== true) {
    const remoteTarget = resolveUpstreamRemoteTarget(repoRoot, manifest, options.remoteUrl)
    const refspecs = [`refs/tags/${targetTag}:refs/tags/${targetTag}`]
    if (!gitRefExists(repoRoot, `${manifest.upstreamBaseTag}^{commit}`)) {
      refspecs.push(`refs/tags/${manifest.upstreamBaseTag}:refs/tags/${manifest.upstreamBaseTag}`)
    }
    runGitOrThrow(
      repoRoot,
      ['fetch', '--no-recurse-submodules', '--force', remoteTarget, ...refspecs],
      `fetch ${targetTag} from ${remoteTarget}`,
    )
  }

  if (!gitRefExists(repoRoot, `${targetTag}^{commit}`)) {
    throw new Error(`fork-ops: target tag ${targetTag} does not exist locally; omit --no-fetch or check the tag name`)
  }

  const branchName = `sync/${targetTag}`
  runGitOrThrow(repoRoot, ['checkout', '-b', branchName], `create synchronization branch ${branchName}`)

  const localTagsOut = tryGit(repoRoot, ['tag', '--list', `${UPSTREAM_TAG_PREFIX}*`])
  const candidateTags = localTagsOut.ok && localTagsOut.stdout !== ''
    ? [...localTagsOut.stdout.split('\n'), targetTag]
    : [targetTag]
  const targetSemver = targetTag.slice(UPSTREAM_TAG_PREFIX.length)
  const newerTagsUpToTarget = filterAndSortNewerUpstreamTags(candidateTags, manifest.upstreamBaseTag)
    .filter(tag => semver.lte(tag.slice(UPSTREAM_TAG_PREFIX.length), targetSemver))
  const effectiveNewerTags = newerTagsUpToTarget.includes(targetTag)
    ? newerTagsUpToTarget
    : [...newerTagsUpToTarget, targetTag]

  const impactReport = buildUpstreamImpactReport(repoRoot, manifest, effectiveNewerTags, targetTag)
  const checklistMarkdown = renderFiveStepChecklist(targetTag, impactReport.markdownSummary)

  return {
    branchName,
    targetTag,
    upstreamBaseTag: manifest.upstreamBaseTag,
    impactReport,
    checklistMarkdown,
  }
}

function normalizeSubcommandArgs(args: readonly string[]): string[] {
  return args[0] === '--' ? args.slice(1) : [...args]
}

/**
 * Execute the `fork-ops` CLI subcommand dispatcher against a repository root.
 * @param argv - CLI arguments following `fork-ops.ts` (starting with the subcommand name).
 * @param options - Optional repository root and output writers.
 * @returns Exit code and captured stdout/stderr strings.
 */
export function runForkOpsCli(argv: readonly string[], options: ForkOpsCliOptions = {}): ForkOpsCliResult {
  const repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT
  const stdoutChunks: string[] = []
  const stderrChunks: string[] = []
  const writeOut = (text: string): void => {
    stdoutChunks.push(text)
    options.writeStdout?.(text)
  }
  const writeErr = (text: string): void => {
    stderrChunks.push(text)
    options.writeStderr?.(text)
  }

  const normalized = normalizeSubcommandArgs(argv)
  const subcommand = normalized[0]
  const restArgs = normalizeSubcommandArgs(normalized.slice(1))

  try {
    if (subcommand === undefined || subcommand === '--help' || subcommand === '-h') {
      writeOut(
        'Usage: fork-ops.ts <status|version|update-methodology|audit-overrides|check-upstream|prepare-upstream-sync> [options]\n',
      )
      return { exitCode: subcommand === undefined ? 1 : 0, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') }
    }

    switch (subcommand) {
      case 'status': {
        const parsed = parseArgs({
          args: restArgs,
          options: {
            json: { type: 'boolean', default: false },
          },
          strict: true,
          allowPositionals: false,
        })
        const report = getForkStatus(repoRoot)
        writeOut(parsed.values.json ? `${JSON.stringify(report, null, 2)}\n` : formatStatusHuman(report))
        return { exitCode: 0, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') }
      }
      case 'version': {
        const parsed = parseArgs({
          args: restArgs,
          options: {
            'upstream-base': { type: 'string' },
          },
          strict: true,
          allowPositionals: true,
        })
        const target = parsed.positionals[0]
        if (target === undefined || parsed.positionals.length > 1) {
          throw new Error('Usage: strata:version <major|minor|patch|X.Y.Z> [--upstream-base <dsh-vX.Y.Z>]')
        }
        const result = bumpStrataVersion({
          repoRoot,
          target,
          upstreamBaseTag: parsed.values['upstream-base'],
        })
        writeOut(
          `StrataHarness version updated: ${result.previousVersion} -> ${result.productVersion} `
          + `(base tag: ${result.upstreamBaseTag})\n`
          + result.updatedFiles.map(file => `  updated ${file}\n`).join(''),
        )
        return { exitCode: 0, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') }
      }
      case 'update-methodology': {
        const parsed = parseArgs({
          args: restArgs,
          options: {
            ref: { type: 'string' },
            remote: { type: 'boolean', default: false },
          },
          strict: true,
          allowPositionals: false,
        })
        const result = updateMethodologySubmodule({
          repoRoot,
          ref: parsed.values.ref,
          remote: parsed.values.remote,
        })
        writeOut(`Methodology submodule verified at ${result.revision} (${result.submodulePath})\n`)
        return { exitCode: 0, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') }
      }
      case 'audit-overrides': {
        const parsed = parseArgs({
          args: restArgs,
          options: {
            json: { type: 'boolean', default: false },
          },
          strict: true,
          allowPositionals: false,
        })
        const report = auditForkOverrides(repoRoot)
        writeOut(parsed.values.json ? `${JSON.stringify(report, null, 2)}\n` : formatAuditHuman(report))
        return { exitCode: report.ok ? 0 : 1, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') }
      }
      case 'check-upstream': {
        const parsed = parseArgs({
          args: restArgs,
          options: {
            'remote-url': { type: 'string' },
            fetch: { type: 'boolean', default: false },
            local: { type: 'boolean', default: false },
            'allow-dirty': { type: 'boolean', default: false },
            json: { type: 'boolean', default: false },
            markdown: { type: 'boolean', default: false },
          },
          strict: true,
          allowPositionals: false,
        })
        const report = checkUpstreamReleases({
          repoRoot,
          remoteUrl: parsed.values['remote-url'],
          fetch: parsed.values.fetch,
          local: parsed.values.local,
          allowDirty: parsed.values['allow-dirty'],
        })
        if (parsed.values.json) {
          writeOut(`${JSON.stringify(report, null, 2)}\n`)
        } else {
          writeOut(`${report.markdownSummary}\n`)
        }
        return { exitCode: 0, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') }
      }
      case 'prepare-upstream-sync': {
        const parsed = parseArgs({
          args: restArgs,
          options: {
            'no-fetch': { type: 'boolean', default: false },
            'remote-url': { type: 'string' },
          },
          strict: true,
          allowPositionals: true,
        })
        const targetTag = parsed.positionals[0]
        if (targetTag === undefined || parsed.positionals.length > 1) {
          throw new Error('Usage: strata:prepare-upstream-sync <dsh-vX.Y.Z> [--no-fetch] [--remote-url <url-or-path>]')
        }
        const result = prepareUpstreamSync({
          repoRoot,
          targetTag,
          noFetch: parsed.values['no-fetch'],
          remoteUrl: parsed.values['remote-url'],
        })
        writeOut(`Created synchronization branch: ${result.branchName}\n\n${result.checklistMarkdown}`)
        return { exitCode: 0, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') }
      }
      default:
        throw new Error(`fork-ops: unsupported or unimplemented subcommand ${JSON.stringify(subcommand)}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeErr(`${message}\n`)
    return { exitCode: 1, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') }
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  const result = runForkOpsCli(process.argv.slice(2), {
    repoRoot: process.cwd(),
    writeStdout: chunk => process.stdout.write(chunk),
    writeStderr: chunk => process.stderr.write(chunk),
  })
  process.exitCode = result.exitCode
}
