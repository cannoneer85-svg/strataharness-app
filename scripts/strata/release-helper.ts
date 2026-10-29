/**
 * Release preflight, target artifact staging, SHA-256 checksum generation,
 * update-feed assembly, and attributed Markdown release notes for StrataHarness Desktop.
 */

import { createHash } from 'node:crypto'
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import semver from 'semver'
import { getForkStatus, updateMethodologySubmodule } from './fork-ops.ts'

const DEFAULT_REPO_ROOT = resolve(import.meta.dirname, '../..')
const TARGET_MANIFEST_FILENAME = 'strata-target-manifest.json'

/** Canonical desktop release target identifiers required for atomic production releases. */
export const STRATA_RELEASE_TARGETS = ['win-x64', 'mac-arm64', 'mac-x64'] as const

/** Supported StrataHarness desktop release target identifier. */
export type StrataReleaseTarget = (typeof STRATA_RELEASE_TARGETS)[number]

/** Effective code-signing mode resolved for a packaged target. */
export type StrataEffectiveSigningMode = 'signed' | 'unsigned'

/** Prefix required on all StrataHarness desktop release tags (`strata-v<semver>`). */
export const STRATA_RELEASE_TAG_PREFIX = 'strata-v'

/** Options accepted by {@link runReleasePreflight}. */
export interface ReleasePreflightOptions {
  /** Repository root directory; defaults to the current monorepo root. */
  readonly repoRoot?: string | undefined
  /** Git ref triggering the workflow (for example `refs/tags/strata-v1.0.0` or `refs/heads/main`). */
  readonly gitRef?: string | undefined
  /** GitHub Actions event name (`push` or `workflow_dispatch`). */
  readonly eventName?: string | undefined
  /** Target selection string (`all` or comma-separated subset of `win-x64`, `mac-arm64`, `mac-x64`). */
  readonly targets?: string | undefined
  /** True when dispatching a draft GitHub Release. */
  readonly draft?: boolean | undefined
  /** True when dispatching a prerelease GitHub Release. */
  readonly prerelease?: boolean | undefined
  /** Optional path to `$GITHUB_OUTPUT` where workflow outputs are appended. */
  readonly githubOutputPath?: string | undefined
}

/** Validated preflight metadata and job-routing flags returned by {@link runReleasePreflight}. */
export interface ReleasePreflightResult {
  /** Product display name from `strata-product.json`. */
  readonly productName: string
  /** Validated canonical SemVer `productVersion` from `strata-product.json`. */
  readonly productVersion: string
  /** Bundled DSH engine version from root `package.json`. */
  readonly engineVersion: string
  /** Upstream base tag (`dsh-v<semver>`) from `strata-product.json`. */
  readonly upstreamBaseTag: string
  /** Validated revision of `resources/strataharness`. */
  readonly methodologyRevision: string
  /** Resolved GitHub Release tag (`strata-v<productVersion>`). */
  readonly releaseTag: string
  /** Validated target list in canonical order. */
  readonly targets: readonly StrataReleaseTarget[]
  /** True when the Windows (`win-x64`) packaging workflow must run. */
  readonly runWindows: boolean
  /** True when the macOS packaging workflow must run. */
  readonly runMacos: boolean
  /** Target selector forwarded to `strata-macos-package.yml` (`all`, `mac-arm64`, `mac-x64`, or `none`). */
  readonly macosTargets: 'all' | 'mac-arm64' | 'mac-x64' | 'none'
  /** True when the release is marked as a GitHub Draft. */
  readonly isDraft: boolean
  /** True when the release is marked as a GitHub Prerelease. */
  readonly isPrerelease: boolean
}

/** Checksummed file entry staged for release distribution. */
export interface StagedArtifactFile {
  /** Base filename without directory components. */
  readonly filename: string
  /** Target that produced the file, or `all` for aggregate metadata. */
  readonly target: StrataReleaseTarget | 'all'
  /** File size in bytes. */
  readonly size: number
  /** Lowercase hexadecimal SHA-256 digest. */
  readonly sha256: string
  /** Artifact role (`installer`, `blockmap`, `channel-metadata`, or `release-record`). */
  readonly role: 'installer' | 'blockmap' | 'channel-metadata' | 'release-record'
}

/** Per-target manifest written by {@link stagePackagedTarget} as `strata-target-manifest.json`. */
export interface StagedTargetManifest {
  /** Schema version (`1`). */
  readonly schemaVersion: 1
  /** Packaged target identifier. */
  readonly target: StrataReleaseTarget
  /** Product SemVer from `strata-product.json`. */
  readonly productVersion: string
  /** Published build SemVer for this run. */
  readonly buildVersion: string
  /** Bundled DSH engine version from root `package.json`. */
  readonly engineVersion: string
  /** Upstream base tag (`dsh-v<semver>`). */
  readonly upstreamBaseTag: string
  /** Bundled `resources/strataharness` revision. */
  readonly methodologyRevision: string
  /** Requested signing mode (`auto`, `unsigned`, or `signed`). */
  readonly requestedSigningMode: 'auto' | 'unsigned' | 'signed'
  /** Effective signing mode (`signed` or `unsigned`). */
  readonly effectiveSigningMode: StrataEffectiveSigningMode
  /** True when macOS notarization was skipped for internal debugging. */
  readonly skipNotarization: boolean
  /** True when signed `electron-updater` channel metadata (`latest*.yml` / `nightly*.yml`) was emitted. */
  readonly updateFeedEnabled: boolean
  /** Staged distributable files for the target. */
  readonly files: readonly StagedArtifactFile[]
}

/** Options accepted by {@link stagePackagedTarget}. */
export interface StagePackagedTargetOptions {
  /** Repository root directory; defaults to the current monorepo root. */
  readonly repoRoot?: string | undefined
  /** Target identifier (`win-x64`, `mac-arm64`, or `mac-x64`). */
  readonly target: StrataReleaseTarget
  /** Build SemVer; defaults to `strata-product.json` `productVersion`. */
  readonly buildVersion?: string | undefined
  /** Requested signing mode (`auto`, `unsigned`, or `signed`). */
  readonly requestedSigningMode: 'auto' | 'unsigned' | 'signed'
  /** Effective signing mode (`signed` or `unsigned`). */
  readonly effectiveSigningMode: StrataEffectiveSigningMode
  /** True when macOS notarization was skipped. */
  readonly skipNotarization?: boolean | undefined
  /** Optional explicit directory containing `electron-builder` outputs for this target. */
  readonly sourceDir?: string | undefined
  /** Clean staging directory to populate for `actions/upload-artifact`. */
  readonly outDir: string
  /** Optional `$GITHUB_STEP_SUMMARY` file path to append a Markdown summary table. */
  readonly stepSummaryPath?: string | undefined
}

/** Result returned by {@link stagePackagedTarget}. */
export interface StagePackagedTargetResult {
  /** Written target manifest metadata. */
  readonly manifest: StagedTargetManifest
  /** Absolute path to the staging output directory. */
  readonly outDir: string
  /** Markdown summary appended to `$GITHUB_STEP_SUMMARY` when configured. */
  readonly stepSummaryMarkdown: string
}

/** Per-target summary consumed by {@link generateReleaseNotes} and written into `feed-manifest.json`. */
export interface CollectedTargetSummary {
  /** Target identifier (`win-x64`, `mac-arm64`, or `mac-x64`). */
  readonly target: StrataReleaseTarget
  /** Effective signing mode (`signed` or `unsigned`). */
  readonly effectiveSigningMode: StrataEffectiveSigningMode
  /** True when macOS notarization was skipped. */
  readonly skipNotarization: boolean
  /** True when signed `electron-updater` feed files were staged under `strataharness/feeds/<target>/`. */
  readonly updateFeedEnabled: boolean
  /** Primary installer filenames staged for GitHub Releases. */
  readonly installerFilenames: readonly string[]
  /** Relative file paths staged under `update-feed/` for this target. */
  readonly feedFiles: readonly string[]
}

/** Options accepted by {@link generateReleaseNotes}. */
export interface GenerateReleaseNotesOptions {
  /** Product display name (for example `StrataHarness`). */
  readonly productName: string
  /** Canonical product SemVer from `strata-product.json`. */
  readonly productVersion: string
  /** Published build SemVer for this release. */
  readonly buildVersion: string
  /** Bundled DSH engine version from root `package.json`. */
  readonly engineVersion: string
  /** Upstream base tag (`dsh-v<semver>`). */
  readonly upstreamBaseTag: string
  /** Bundled `resources/strataharness` submodule revision. */
  readonly methodologyRevision: string
  /** True when creating a GitHub Draft release. */
  readonly isDraft: boolean
  /** True when creating a GitHub Prerelease. */
  readonly isPrerelease: boolean
  /** Per-target signing and feed summaries in canonical order. */
  readonly targets: readonly CollectedTargetSummary[]
  /** Staged GitHub Release assets with sizes and SHA-256 digests. */
  readonly assets: readonly StagedArtifactFile[]
}

/** Options accepted by {@link collectReleaseArtifacts}. */
export interface CollectReleaseArtifactsOptions {
  /** Repository root directory; defaults to the current monorepo root. */
  readonly repoRoot?: string | undefined
  /** Directory containing downloaded `strata-dist-<target>` subdirectories. */
  readonly artifactsDir: string
  /** Output bundle directory for `release-assets/`, `SHA256SUMS.txt`, `RELEASE_NOTES.md`, and `update-feed/`. */
  readonly outDir: string
  /** Target selection (`all` for production, or subset when `draft` / `prerelease` is true). */
  readonly targets?: string | undefined
  /** Build SemVer; defaults to `strata-product.json` `productVersion`. */
  readonly buildVersion?: string | undefined
  /** True when assembling a draft release. */
  readonly draft?: boolean | undefined
  /** True when assembling a prerelease. */
  readonly prerelease?: boolean | undefined
  /** Optional path to `$GITHUB_OUTPUT`. */
  readonly githubOutputPath?: string | undefined
  /** Optional path to `$GITHUB_STEP_SUMMARY`. */
  readonly stepSummaryPath?: string | undefined
}

/** Result returned by {@link collectReleaseArtifacts}. */
export interface CollectReleaseArtifactsResult {
  /** Published build SemVer. */
  readonly buildVersion: string
  /** Canonical product SemVer from `strata-product.json`. */
  readonly productVersion: string
  /** Bundled DSH engine version. */
  readonly engineVersion: string
  /** Upstream base tag (`dsh-v<semver>`). */
  readonly upstreamBaseTag: string
  /** Bundled methodology submodule revision. */
  readonly methodologyRevision: string
  /** Directory containing flat files to upload to GitHub Releases (including `SHA256SUMS.txt`). */
  readonly releaseAssetsDir: string
  /** Path to `SHA256SUMS.txt`. */
  readonly sha256SumsPath: string
  /** Formatted contents of `SHA256SUMS.txt`. */
  readonly sha256SumsContent: string
  /** Path to `RELEASE_NOTES.md`. */
  readonly releaseNotesPath: string
  /** Formatted contents of `RELEASE_NOTES.md`. */
  readonly releaseNotesMarkdown: string
  /** Directory containing `feed-manifest.json` and optional `strataharness/feeds/<target>/` tree. */
  readonly updateFeedDir: string
  /** True when every collected target is signed and emitted static update-feed metadata ready for S3 sync. */
  readonly feedReady: boolean
  /** Collected per-target summaries. */
  readonly targets: readonly CollectedTargetSummary[]
  /** Checksummed assets staged in `releaseAssetsDir` (excluding `SHA256SUMS.txt` itself). */
  readonly assets: readonly StagedArtifactFile[]
}

/** Injectable runtime options for {@link runReleaseHelperCli}. */
export interface ReleaseHelperCliOptions {
  /** Repository root directory; defaults to the current monorepo root. */
  readonly repoRoot?: string
  /** Environment variables consulted by CLI defaults; defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv
  /** Optional stdout sink. */
  readonly writeStdout?: (chunk: string) => void
  /** Optional stderr sink. */
  readonly writeStderr?: (chunk: string) => void
}

/** Result returned by {@link runReleaseHelperCli}. */
export interface ReleaseHelperCliResult {
  /** Exit status (`0` on success, `1` on validation or IO error). */
  readonly exitCode: number
  /** Captured standard output text. */
  readonly stdout: string
  /** Captured standard error text. */
  readonly stderr: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isReleaseTarget(value: string): value is StrataReleaseTarget {
  return (STRATA_RELEASE_TARGETS as readonly string[]).includes(value)
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function validateCanonicalSemVer(value: string, label: string): string {
  const parsed = semver.parse(value, { loose: false })
  if (parsed === null || parsed.version !== value || parsed.build.length > 0) {
    throw new Error(`release-helper: ${label} ${JSON.stringify(value)} is not a valid canonical SemVer version`)
  }
  return parsed.version
}

function sha256File(filePath: string): { readonly sha256: string; readonly size: number } {
  const details = statSync(filePath, { throwIfNoEntry: false })
  if (details === undefined || !details.isFile()) {
    throw new Error(`release-helper: expected regular file at ${filePath}`)
  }
  if (details.size <= 0) {
    throw new Error(`release-helper: artifact file ${filePath} is empty (0 bytes)`)
  }
  const digest = createHash('sha256').update(readFileSync(filePath)).digest('hex')
  return { sha256: digest, size: details.size }
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
}

function expectedPrimaryInstallers(
  target: StrataReleaseTarget,
  buildVersion: string,
  suffix: '' | '-unsigned' | '-unnotarized',
): readonly string[] {
  const base = `strataharness-${buildVersion}-${target}${suffix}`
  return target === 'win-x64' ? [`${base}.exe`] : [`${base}.dmg`, `${base}.zip`]
}

function candidateChannelMetadataNames(target: StrataReleaseTarget): readonly string[] {
  return target === 'win-x64' ? ['latest.yml', 'nightly.yml'] : ['latest-mac.yml', 'nightly-mac.yml']
}

function targetPlatformLabel(target: StrataReleaseTarget): string {
  switch (target) {
    case 'win-x64':
      return 'Windows x64'
    case 'mac-arm64':
      return 'macOS Apple Silicon (arm64)'
    case 'mac-x64':
      return 'macOS Intel (x64)'
  }
}

function parseBooleanFlag(raw: string | undefined): boolean {
  if (raw === undefined) return false
  const normalized = raw.trim().toLowerCase()
  return normalized === 'true' || normalized === '1'
}

/**
 * Parse a release target selector (`all` or comma-separated target names) into canonical target order.
 * @param rawTargets - Raw target selector string.
 * @returns Deduplicated release targets in canonical order.
 */
export function parseReleaseTargets(rawTargets?: string): readonly StrataReleaseTarget[] {
  const trimmed = rawTargets?.trim() ?? ''
  if (trimmed === '' || trimmed === 'all') {
    return [...STRATA_RELEASE_TARGETS]
  }
  const requested = new Set<StrataReleaseTarget>()
  for (const part of trimmed.split(',')) {
    const token = part.trim()
    if (token === '') continue
    if (!isReleaseTarget(token)) {
      throw new Error(
        `release-helper: unsupported release target ${JSON.stringify(token)}; expected "all" or a subset of ${STRATA_RELEASE_TARGETS.join(', ')}`,
      )
    }
    requested.add(token)
  }
  if (requested.size === 0) {
    throw new Error('release-helper: target selection resolved to zero targets')
  }
  return STRATA_RELEASE_TARGETS.filter(target => requested.has(target))
}

/**
 * Validate `strata-product.json`, tag parity, `resources/strataharness` initialization, and atomic target rules.
 * @param options - Preflight inputs and optional `$GITHUB_OUTPUT` path.
 * @returns Validated version metadata and packaging job routing flags.
 */
export function runReleasePreflight(options: ReleasePreflightOptions = {}): ReleasePreflightResult {
  const repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT
  const status = getForkStatus(repoRoot)
  const methodology = updateMethodologySubmodule({ repoRoot })

  const gitRef = options.gitRef?.trim() ?? ''
  const isTagEvent =
    options.eventName === 'push'
    || gitRef.startsWith('refs/tags/')
    || gitRef.startsWith(STRATA_RELEASE_TAG_PREFIX)

  let releaseTag = `${STRATA_RELEASE_TAG_PREFIX}${status.productVersion}`
  if (isTagEvent) {
    const normalizedTag = gitRef.replace(/^refs\/tags\//u, '')
    if (!normalizedTag.startsWith(STRATA_RELEASE_TAG_PREFIX)) {
      throw new Error(
        `release-helper: release tag ${JSON.stringify(normalizedTag)} must start with "${STRATA_RELEASE_TAG_PREFIX}"`,
      )
    }
    const tagVersion = validateCanonicalSemVer(
      normalizedTag.slice(STRATA_RELEASE_TAG_PREFIX.length),
      'release tag version',
    )
    if (tagVersion !== status.productVersion) {
      throw new Error(
        `release-helper: release tag ${normalizedTag} does not match strata-product.json productVersion ${status.productVersion}`,
      )
    }
    releaseTag = normalizedTag
  }

  const isDraft = options.draft === true
  const isPrerelease = options.prerelease === true || semver.prerelease(status.productVersion) !== null
  const targets = parseReleaseTargets(options.targets)

  if (targets.length < STRATA_RELEASE_TARGETS.length && !isDraft && !isPrerelease) {
    throw new Error(
      `release-helper: subset target selection (${targets.join(', ')}) is blocked for production releases; select "all" or enable draft/prerelease`,
    )
  }

  const runWindows = targets.includes('win-x64')
  const macList = targets.filter(
    (target): target is 'mac-arm64' | 'mac-x64' => target === 'mac-arm64' || target === 'mac-x64',
  )
  const runMacos = macList.length > 0
  const macosTargets: 'all' | 'mac-arm64' | 'mac-x64' | 'none' =
    macList.length === 2 ? 'all' : (macList[0] ?? 'none')

  const result: ReleasePreflightResult = {
    productName: status.productName,
    productVersion: status.productVersion,
    engineVersion: status.engineVersion,
    upstreamBaseTag: status.upstreamBaseTag,
    methodologyRevision: methodology.revision,
    releaseTag,
    targets,
    runWindows,
    runMacos,
    macosTargets,
    isDraft,
    isPrerelease,
  }

  if (options.githubOutputPath !== undefined && options.githubOutputPath.trim() !== '') {
    const lines = [
      `version=${result.productVersion}`,
      `engine_version=${result.engineVersion}`,
      `upstream_base_tag=${result.upstreamBaseTag}`,
      `methodology_revision=${result.methodologyRevision}`,
      `release_tag=${result.releaseTag}`,
      `targets=${result.targets.join(',')}`,
      `run_windows=${result.runWindows ? 'true' : 'false'}`,
      `run_macos=${result.runMacos ? 'true' : 'false'}`,
      `macos_targets=${result.macosTargets}`,
      `is_draft=${result.isDraft ? 'true' : 'false'}`,
      `is_prerelease=${result.isPrerelease ? 'true' : 'false'}`,
    ]
    appendFileSync(options.githubOutputPath, `${lines.join('\n')}\n`, 'utf8')
  }

  return result
}

/**
 * Format deterministic `SHA256SUMS.txt` lines (`<sha256>  <filename>`) sorted by filename.
 * @param files - Files to hash.
 * @returns Formatted `SHA256SUMS.txt` content ending with a newline.
 */
export function computeSha256Sums(
  files: ReadonlyArray<{ readonly filename: string; readonly filePath: string }>,
): string {
  if (files.length === 0) {
    throw new Error('release-helper: cannot compute SHA256SUMS.txt for zero files')
  }
  const sorted = [...files].sort((left, right) => compareAscii(left.filename, right.filename))
  const lines = sorted.map((entry) => {
    const { sha256 } = sha256File(entry.filePath)
    return `${sha256}  ${entry.filename}`
  })
  return `${lines.join('\n')}\n`
}

/**
 * Generate attributed Markdown release notes with dual-track version metadata and unsigned first-launch guidance.
 * @param options - Release metadata, target signing status, and checksummed assets.
 * @returns Complete `RELEASE_NOTES.md` text.
 */
export function generateReleaseNotes(options: GenerateReleaseNotesOptions): string {
  const releaseChannelLabel = options.isDraft
    ? 'Draft'
    : options.isPrerelease
      ? 'Prerelease'
      : 'Production'
  const anyFeedEnabled = options.targets.some(target => target.updateFeedEnabled)
  const anyUnsignedOrUnnotarized = options.targets.some(
    target => target.effectiveSigningMode === 'unsigned' || target.skipNotarization,
  )

  const lines: string[] = [
    `# ${options.productName} v${options.buildVersion}`,
    '',
    '## Release Metadata',
    '',
    `- Product: ${options.productName} v${options.productVersion}${options.buildVersion === options.productVersion ? '' : ` (build \`${options.buildVersion}\`)`}`,
    `- Engine: DSH ${options.engineVersion} (${options.upstreamBaseTag})`,
    `- Methodology Submodule (\`resources/strataharness\`): \`${options.methodologyRevision}\``,
    `- Release Channel: ${releaseChannelLabel}`,
    `- Static Auto-Update Feed: ${anyFeedEnabled ? 'Enabled (`strataharness/feeds/<target>/`)' : 'Disabled (`publish: null`)'}`,
    '',
    '## Platform Signing Status',
    '',
    '| Target | Platform | Signing Status | Auto-Update Feed | Installers |',
    '|---|---|---|---|---|',
    ...options.targets.map((entry) => {
      const signingLabel = entry.effectiveSigningMode === 'unsigned'
        ? '`unsigned`'
        : entry.skipNotarization
          ? '`signed` (notarization skipped)'
          : '`signed`'
      const feedLabel = entry.updateFeedEnabled ? '`strataharness/feeds/' + entry.target + '/`' : 'disabled'
      const installersLabel = entry.installerFilenames.map(name => `\`${name}\``).join(', ')
      return `| \`${entry.target}\` | ${targetPlatformLabel(entry.target)} | ${signingLabel} | ${feedLabel} | ${installersLabel} |`
    }),
  ]

  if (anyUnsignedOrUnnotarized) {
    lines.push(
      '',
      '## First-Launch Instructions for Unsigned Builds',
      '',
      '> **Note:** One or more targets in this release were built without paid code-signing / notarization certificates (`unsigned` mode). Auto-update feed metadata (`latest*.yml`) is intentionally omitted for unsigned builds so unverified binaries are never installed silently.',
      '',
      '### macOS (Gatekeeper Quarantine)',
      '',
      '1. Open the `.dmg` (or extract the `.zip`) and move `StrataHarness.app` into `/Applications`.',
      '2. Clear the macOS quarantine attribute in Terminal before first launch:',
      '',
      '```sh',
      'xattr -cr /Applications/StrataHarness.app',
      '```',
      '',
      '*(Alternatively, attempt to open `StrataHarness.app` once, then open **System Settings → Privacy & Security** and click **Open Anyway**.)*',
      '',
      '### Windows (Microsoft Defender SmartScreen)',
      '',
      '1. Launch `strataharness-' + options.buildVersion + '-win-x64-unsigned.exe`.',
      '2. In the Windows protected your PC (SmartScreen) dialog, click **More info**, then click **Run anyway**.',
    )
  }

  const sortedAssets = [...options.assets].sort((left, right) => compareAscii(left.filename, right.filename))
  lines.push(
    '',
    '## Release Assets & SHA-256 Checksums',
    '',
    '| File | Target | Size | SHA-256 |',
    '|---|---|---|---|',
    ...sortedAssets.map(
      asset => `| \`${asset.filename}\` | \`${asset.target}\` | ${formatByteSize(asset.size)} | \`${asset.sha256}\` |`,
    ),
    '',
    '### Verifying Checksums',
    '',
    '- **macOS / Linux:** `sha256sum -c SHA256SUMS.txt` (or `shasum -a 256 -c SHA256SUMS.txt`)',
    '- **Windows (PowerShell):** `Get-FileHash .\\strataharness-*.exe -Algorithm SHA256`',
    '',
  )

  return lines.join('\n')
}

function defaultTargetSourceDir(
  repoRoot: string,
  target: StrataReleaseTarget,
  effectiveSigningMode: StrataEffectiveSigningMode,
  skipNotarization: boolean,
): string {
  const folder = effectiveSigningMode === 'unsigned'
    ? 'unsigned-artifacts'
    : skipNotarization
      ? 'unnotarized-artifacts'
      : 'artifacts'
  return join(repoRoot, 'apps', 'desktop', '.desktop-build', 'targets', target, folder)
}

/**
 * Verify built target installers, stage distributable files without unpacked directories, and emit `strata-target-manifest.json`.
 * @param options - Target packaging details and staging paths.
 * @returns Staged manifest and Markdown step summary.
 */
export function stagePackagedTarget(options: StagePackagedTargetOptions): StagePackagedTargetResult {
  const repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT
  if (!isReleaseTarget(options.target)) {
    throw new Error(`release-helper: unsupported target ${JSON.stringify(options.target)}`)
  }
  const status = getForkStatus(repoRoot)
  const methodology = updateMethodologySubmodule({ repoRoot })
  const buildVersion = options.buildVersion !== undefined && options.buildVersion.trim() !== ''
    ? validateCanonicalSemVer(options.buildVersion.trim(), 'buildVersion')
    : status.productVersion
  const skipNotarization = options.skipNotarization === true
  const suffix: '' | '-unsigned' | '-unnotarized' = options.effectiveSigningMode === 'unsigned'
    ? '-unsigned'
    : skipNotarization
      ? '-unnotarized'
      : ''

  const sourceDir = options.sourceDir ?? defaultTargetSourceDir(
    repoRoot,
    options.target,
    options.effectiveSigningMode,
    skipNotarization,
  )
  if (!existsSync(sourceDir)) {
    throw new Error(`release-helper: packaged output directory not found for ${options.target}: ${sourceDir}`)
  }

  const requiredInstallers = expectedPrimaryInstallers(options.target, buildVersion, suffix)
  const stagedEntries: Array<{ readonly filename: string; readonly role: StagedArtifactFile['role'] }> = []

  for (const filename of requiredInstallers) {
    const candidatePath = join(sourceDir, filename)
    if (!existsSync(candidatePath)) {
      throw new Error(`release-helper: missing required installer ${filename} in ${sourceDir}`)
    }
    sha256File(candidatePath)
    stagedEntries.push({ filename, role: 'installer' })
  }

  let updateFeedEnabled = false
  if (options.effectiveSigningMode === 'signed' && !skipNotarization) {
    const base = `strataharness-${buildVersion}-${options.target}`
    const blockmapFilename = `${base}.${options.target === 'win-x64' ? 'exe' : 'zip'}.blockmap`
    const blockmapPath = join(sourceDir, blockmapFilename)
    if (existsSync(blockmapPath) && statSync(blockmapPath).size > 0) {
      stagedEntries.push({ filename: blockmapFilename, role: 'blockmap' })
    }

    const recordFilename = `${options.target}-release.json`
    const recordPath = join(sourceDir, recordFilename)
    if (existsSync(recordPath) && statSync(recordPath).size > 0) {
      stagedEntries.push({ filename: recordFilename, role: 'release-record' })
    }

    for (const metadataName of candidateChannelMetadataNames(options.target)) {
      const metadataPath = join(sourceDir, metadataName)
      if (existsSync(metadataPath) && statSync(metadataPath).size > 0) {
        stagedEntries.push({ filename: metadataName, role: 'channel-metadata' })
        updateFeedEnabled = true
        break
      }
    }
  }

  const outDir = resolve(options.outDir)
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  const stagedFiles: StagedArtifactFile[] = []
  for (const entry of stagedEntries) {
    const sourcePath = join(sourceDir, entry.filename)
    const destPath = join(outDir, entry.filename)
    copyFileSync(sourcePath, destPath)
    const { sha256, size } = sha256File(destPath)
    stagedFiles.push({
      filename: entry.filename,
      target: options.target,
      size,
      sha256,
      role: entry.role,
    })
  }

  const manifest: StagedTargetManifest = {
    schemaVersion: 1,
    target: options.target,
    productVersion: status.productVersion,
    buildVersion,
    engineVersion: status.engineVersion,
    upstreamBaseTag: status.upstreamBaseTag,
    methodologyRevision: methodology.revision,
    requestedSigningMode: options.requestedSigningMode,
    effectiveSigningMode: options.effectiveSigningMode,
    skipNotarization,
    updateFeedEnabled,
    files: stagedFiles,
  }
  writeFileSync(join(outDir, TARGET_MANIFEST_FILENAME), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  const stepSummaryMarkdown = [
    `### StrataHarness Package Summary · \`${options.target}\``,
    '',
    `- **Product Version:** \`${status.productVersion}\` (build \`${buildVersion}\`)`,
    `- **Engine Version:** \`DSH ${status.engineVersion}\` (\`${status.upstreamBaseTag}\`)`,
    `- **Methodology Submodule:** \`${methodology.revision}\``,
    `- **Signing Mode:** requested \`${options.requestedSigningMode}\` → effective \`${options.effectiveSigningMode}\`${skipNotarization ? ' (notarization skipped)' : ''}`,
    `- **Auto-Update Feed Metadata:** ${updateFeedEnabled ? 'generated' : 'omitted (`publish: null`)'}`,
    '',
    '| File | Role | Size | SHA-256 |',
    '|---|---|---|---|',
    ...stagedFiles.map(
      file => `| \`${file.filename}\` | \`${file.role}\` | ${formatByteSize(file.size)} | \`${file.sha256}\` |`,
    ),
    '',
  ].join('\n')

  if (options.stepSummaryPath !== undefined && options.stepSummaryPath.trim() !== '') {
    mkdirSync(dirname(options.stepSummaryPath), { recursive: true })
    appendFileSync(options.stepSummaryPath, `${stepSummaryMarkdown}\n`, 'utf8')
  }

  return {
    manifest,
    outDir,
    stepSummaryMarkdown,
  }
}

interface DiscoveredTargetDirectory {
  readonly target: StrataReleaseTarget
  readonly dirPath: string
  readonly effectiveSigningMode: StrataEffectiveSigningMode
  readonly skipNotarization: boolean
  readonly installerFilenames: readonly string[]
  readonly blockmapFilename: string | null
  readonly channelMetadataFilename: string | null
}

function inspectDownloadedTarget(
  artifactsDir: string,
  target: StrataReleaseTarget,
  buildVersion: string,
  allowUnnotarized: boolean,
): DiscoveredTargetDirectory {
  const prefixedDir = join(artifactsDir, `strata-dist-${target}`)
  const plainDir = join(artifactsDir, target)
  const dirPath = existsSync(prefixedDir) ? prefixedDir : existsSync(plainDir) ? plainDir : null
  if (dirPath === null) {
    throw new Error(
      `release-helper: missing downloaded artifact directory for required target ${target} under ${artifactsDir}`,
    )
  }

  let effectiveSigningMode: StrataEffectiveSigningMode | undefined
  let skipNotarization = false
  const manifestPath = join(dirPath, TARGET_MANIFEST_FILENAME)
  if (existsSync(manifestPath)) {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (!isRecord(parsed)) {
      throw new Error(`release-helper: invalid ${TARGET_MANIFEST_FILENAME} in ${dirPath}`)
    }
    if (parsed.target !== target) {
      throw new Error(
        `release-helper: ${TARGET_MANIFEST_FILENAME} target mismatch in ${dirPath}: expected ${target}, got ${String(parsed.target)}`,
      )
    }
    if (typeof parsed.buildVersion === 'string' && parsed.buildVersion !== buildVersion) {
      throw new Error(
        `release-helper: ${TARGET_MANIFEST_FILENAME} buildVersion ${parsed.buildVersion} in ${dirPath} does not match expected ${buildVersion}`,
      )
    }
    if (parsed.effectiveSigningMode === 'signed' || parsed.effectiveSigningMode === 'unsigned') {
      effectiveSigningMode = parsed.effectiveSigningMode
    }
    skipNotarization = parsed.skipNotarization === true
  }

  if (effectiveSigningMode === undefined) {
    const unsignedInstallers = expectedPrimaryInstallers(target, buildVersion, '-unsigned')
    const unnotarizedInstallers = expectedPrimaryInstallers(target, buildVersion, '-unnotarized')
    const signedInstallers = expectedPrimaryInstallers(target, buildVersion, '')
    if (unsignedInstallers.some(name => existsSync(join(dirPath, name)))) {
      effectiveSigningMode = 'unsigned'
    } else if (unnotarizedInstallers.some(name => existsSync(join(dirPath, name)))) {
      effectiveSigningMode = 'signed'
      skipNotarization = true
    } else if (signedInstallers.some(name => existsSync(join(dirPath, name)))) {
      effectiveSigningMode = 'signed'
    } else {
      throw new Error(
        `release-helper: no matching ${buildVersion} installers found for target ${target} in ${dirPath}`,
      )
    }
  }

  if (skipNotarization && !allowUnnotarized) {
    throw new Error(
      `release-helper: unnotarized macOS debugging artifacts for ${target} cannot be published in a production release`,
    )
  }

  const suffix: '' | '-unsigned' | '-unnotarized' = effectiveSigningMode === 'unsigned'
    ? '-unsigned'
    : skipNotarization
      ? '-unnotarized'
      : ''
  const installerFilenames = expectedPrimaryInstallers(target, buildVersion, suffix)
  for (const filename of installerFilenames) {
    const filePath = join(dirPath, filename)
    if (!existsSync(filePath)) {
      throw new Error(`release-helper: target ${target} is missing required primary installer ${filename} in ${dirPath}`)
    }
    sha256File(filePath)
  }

  const entries = readdirSync(dirPath)
  if (effectiveSigningMode === 'unsigned' || skipNotarization) {
    const forbiddenFeed = entries.find(name => /^(?:latest|nightly)(?:-mac)?\.yml$/u.test(name))
    if (forbiddenFeed !== undefined) {
      throw new Error(
        `release-helper: unsigned or unnotarized target ${target} must not carry auto-update metadata (${forbiddenFeed})`,
      )
    }
    return {
      target,
      dirPath,
      effectiveSigningMode,
      skipNotarization,
      installerFilenames,
      blockmapFilename: null,
      channelMetadataFilename: null,
    }
  }

  const base = `strataharness-${buildVersion}-${target}`
  const expectedBlockmap = `${base}.${target === 'win-x64' ? 'exe' : 'zip'}.blockmap`
  const blockmapFilename = existsSync(join(dirPath, expectedBlockmap)) && statSync(join(dirPath, expectedBlockmap)).size > 0
    ? expectedBlockmap
    : null

  let channelMetadataFilename: string | null = null
  for (const candidate of candidateChannelMetadataNames(target)) {
    const candidatePath = join(dirPath, candidate)
    if (existsSync(candidatePath) && statSync(candidatePath).size > 0) {
      channelMetadataFilename = candidate
      break
    }
  }

  return {
    target,
    dirPath,
    effectiveSigningMode,
    skipNotarization,
    installerFilenames,
    blockmapFilename,
    channelMetadataFilename,
  }
}

/**
 * Collect downloaded target artifacts, enforce atomic 3-target production completeness,
 * and build `SHA256SUMS.txt`, `RELEASE_NOTES.md`, and `update-feed/`.
 * @param options - Downloaded artifact directory, release flags, and bundle output directory.
 * @returns Paths and contents of all staged release outputs.
 */
export function collectReleaseArtifacts(options: CollectReleaseArtifactsOptions): CollectReleaseArtifactsResult {
  const repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT
  const status = getForkStatus(repoRoot)
  const methodology = updateMethodologySubmodule({ repoRoot })
  const buildVersion = options.buildVersion !== undefined && options.buildVersion.trim() !== ''
    ? validateCanonicalSemVer(options.buildVersion.trim(), 'buildVersion')
    : status.productVersion
  const isDraft = options.draft === true
  const isPrerelease = options.prerelease === true || semver.prerelease(buildVersion) !== null
  const requestedTargets = parseReleaseTargets(options.targets)

  if (!isDraft && !isPrerelease && requestedTargets.length < STRATA_RELEASE_TARGETS.length) {
    throw new Error(
      `release-helper: atomic production release requires all 3 targets (${STRATA_RELEASE_TARGETS.join(', ')}), got ${requestedTargets.join(', ')}`,
    )
  }
  const requiredTargets = !isDraft && !isPrerelease ? [...STRATA_RELEASE_TARGETS] : requestedTargets

  const outDir = resolve(options.outDir)
  const releaseAssetsDir = join(outDir, 'release-assets')
  const updateFeedDir = join(outDir, 'update-feed')
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(releaseAssetsDir, { recursive: true })
  mkdirSync(updateFeedDir, { recursive: true })

  const discovered = requiredTargets.map(target =>
    inspectDownloadedTarget(options.artifactsDir, target, buildVersion, isDraft || isPrerelease),
  )

  const macFeedTargetsCount = discovered.filter(
    item => (item.target === 'mac-arm64' || item.target === 'mac-x64') && item.channelMetadataFilename !== null,
  ).length

  const stagedAssets: StagedArtifactFile[] = []
  const targetSummaries: CollectedTargetSummary[] = []

  for (const item of discovered) {
    for (const installerName of item.installerFilenames) {
      const srcPath = join(item.dirPath, installerName)
      const dstPath = join(releaseAssetsDir, installerName)
      copyFileSync(srcPath, dstPath)
      const { sha256, size } = sha256File(dstPath)
      stagedAssets.push({
        filename: installerName,
        target: item.target,
        size,
        sha256,
        role: 'installer',
      })
    }

    const feedFiles: string[] = []
    if (item.channelMetadataFilename !== null) {
      const feedTargetDir = join(updateFeedDir, 'strataharness', 'feeds', item.target)
      mkdirSync(feedTargetDir, { recursive: true })

      for (const installerName of item.installerFilenames) {
        copyFileSync(join(item.dirPath, installerName), join(feedTargetDir, installerName))
        feedFiles.push(`strataharness/feeds/${item.target}/${installerName}`)
      }
      if (item.blockmapFilename !== null) {
        copyFileSync(join(item.dirPath, item.blockmapFilename), join(feedTargetDir, item.blockmapFilename))
        feedFiles.push(`strataharness/feeds/${item.target}/${item.blockmapFilename}`)
      }
      copyFileSync(
        join(item.dirPath, item.channelMetadataFilename),
        join(feedTargetDir, item.channelMetadataFilename),
      )
      feedFiles.push(`strataharness/feeds/${item.target}/${item.channelMetadataFilename}`)

      const releaseMetadataFilename =
        item.target === 'win-x64' || macFeedTargetsCount <= 1
          ? item.channelMetadataFilename
          : item.channelMetadataFilename.replace('-mac.yml', `-${item.target}.yml`)
      const releaseMetaDst = join(releaseAssetsDir, releaseMetadataFilename)
      copyFileSync(join(item.dirPath, item.channelMetadataFilename), releaseMetaDst)
      const { sha256, size } = sha256File(releaseMetaDst)
      stagedAssets.push({
        filename: releaseMetadataFilename,
        target: item.target,
        size,
        sha256,
        role: 'channel-metadata',
      })
    }

    targetSummaries.push({
      target: item.target,
      effectiveSigningMode: item.effectiveSigningMode,
      skipNotarization: item.skipNotarization,
      updateFeedEnabled: item.channelMetadataFilename !== null,
      installerFilenames: item.installerFilenames,
      feedFiles,
    })
  }

  const sha256SumsContent = computeSha256Sums(
    stagedAssets.map(asset => ({
      filename: asset.filename,
      filePath: join(releaseAssetsDir, asset.filename),
    })),
  )
  const sha256SumsPath = join(outDir, 'SHA256SUMS.txt')
  writeFileSync(sha256SumsPath, sha256SumsContent, 'utf8')
  writeFileSync(join(releaseAssetsDir, 'SHA256SUMS.txt'), sha256SumsContent, 'utf8')

  const releaseNotesMarkdown = generateReleaseNotes({
    productName: status.productName,
    productVersion: status.productVersion,
    buildVersion,
    engineVersion: status.engineVersion,
    upstreamBaseTag: status.upstreamBaseTag,
    methodologyRevision: methodology.revision,
    isDraft,
    isPrerelease,
    targets: targetSummaries,
    assets: stagedAssets,
  })
  const releaseNotesPath = join(outDir, 'RELEASE_NOTES.md')
  writeFileSync(releaseNotesPath, releaseNotesMarkdown, 'utf8')

  const feedReady =
    targetSummaries.length > 0
    && targetSummaries.every(
      target => target.effectiveSigningMode === 'signed' && !target.skipNotarization && target.updateFeedEnabled,
    )

  const feedManifest = {
    schemaVersion: 1,
    productName: status.productName,
    productVersion: status.productVersion,
    buildVersion,
    engineVersion: status.engineVersion,
    upstreamBaseTag: status.upstreamBaseTag,
    methodologyRevision: methodology.revision,
    feedReady,
    targets: targetSummaries,
  }
  writeFileSync(
    join(updateFeedDir, 'feed-manifest.json'),
    `${JSON.stringify(feedManifest, null, 2)}\n`,
    'utf8',
  )

  if (options.githubOutputPath !== undefined && options.githubOutputPath.trim() !== '') {
    const lines = [
      `feed_ready=${feedReady ? 'true' : 'false'}`,
      `release_assets_dir=${releaseAssetsDir}`,
      `sha256sums_path=${sha256SumsPath}`,
      `release_notes_path=${releaseNotesPath}`,
      `update_feed_dir=${updateFeedDir}`,
      `asset_count=${String(stagedAssets.length + 1)}`,
    ]
    appendFileSync(options.githubOutputPath, `${lines.join('\n')}\n`, 'utf8')
  }

  if (options.stepSummaryPath !== undefined && options.stepSummaryPath.trim() !== '') {
    mkdirSync(dirname(options.stepSummaryPath), { recursive: true })
    appendFileSync(options.stepSummaryPath, `${releaseNotesMarkdown}\n`, 'utf8')
  }

  return {
    buildVersion,
    productVersion: status.productVersion,
    engineVersion: status.engineVersion,
    upstreamBaseTag: status.upstreamBaseTag,
    methodologyRevision: methodology.revision,
    releaseAssetsDir,
    sha256SumsPath,
    sha256SumsContent,
    releaseNotesPath,
    releaseNotesMarkdown,
    updateFeedDir,
    feedReady,
    targets: targetSummaries,
    assets: stagedAssets,
  }
}

function normalizeSubcommandArgs(args: readonly string[]): string[] {
  return args[0] === '--' ? args.slice(1) : [...args]
}

/**
 * Execute the `release-helper.ts` CLI (`preflight`, `stage-target`, `collect`, `checksums`).
 * @param argv - Command-line arguments after the script name.
 * @param options - Optional repository root, environment, and output writers.
 * @returns Exit code and captured stdout/stderr streams.
 */
export function runReleaseHelperCli(
  argv: readonly string[],
  options: ReleaseHelperCliOptions = {},
): ReleaseHelperCliResult {
  const repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT
  const env = options.env ?? process.env
  let stdout = ''
  let stderr = ''
  const emitOut = (chunk: string): void => {
    stdout += chunk
    options.writeStdout?.(chunk)
  }
  const emitErr = (chunk: string): void => {
    stderr += chunk
    options.writeStderr?.(chunk)
  }

  const normalized = normalizeSubcommandArgs(argv)
  const subcommand = normalized[0]
  const restArgs = normalizeSubcommandArgs(normalized.slice(1))

  try {
    switch (subcommand) {
      case 'preflight': {
        const parsed = parseArgs({
          args: restArgs,
          options: {
            'git-ref': { type: 'string' },
            'event-name': { type: 'string' },
            targets: { type: 'string' },
            draft: { type: 'boolean', default: false },
            prerelease: { type: 'boolean', default: false },
            'github-output': { type: 'string' },
            json: { type: 'boolean', default: false },
          },
          strict: true,
        })
        const result = runReleasePreflight({
          repoRoot,
          gitRef: parsed.values['git-ref'] ?? env.GITHUB_REF,
          eventName: parsed.values['event-name'] ?? env.GITHUB_EVENT_NAME,
          targets: parsed.values.targets ?? env.INPUT_TARGETS ?? 'all',
          draft: parsed.values.draft || parseBooleanFlag(env.INPUT_DRAFT),
          prerelease: parsed.values.prerelease || parseBooleanFlag(env.INPUT_PRERELEASE),
          githubOutputPath: parsed.values['github-output'] ?? env.GITHUB_OUTPUT,
        })
        if (parsed.values.json) {
          emitOut(`${JSON.stringify(result, null, 2)}\n`)
        } else {
          emitOut(
            `Preflight OK: ${result.productName} ${result.productVersion} (${result.releaseTag}) | Engine DSH ${result.engineVersion} (${result.upstreamBaseTag}) | Targets: ${result.targets.join(', ')}\n`,
          )
        }
        return { exitCode: 0, stdout, stderr }
      }

      case 'stage-target': {
        const parsed = parseArgs({
          args: restArgs,
          options: {
            target: { type: 'string' },
            version: { type: 'string' },
            'requested-signing-mode': { type: 'string' },
            'effective-signing-mode': { type: 'string' },
            'skip-notarization': { type: 'boolean', default: false },
            'source-dir': { type: 'string' },
            'out-dir': { type: 'string' },
            'step-summary': { type: 'string' },
            json: { type: 'boolean', default: false },
          },
          strict: true,
        })
        const target = parsed.values.target ?? ''
        if (!isReleaseTarget(target)) {
          throw new Error(`release-helper: --target must be one of ${STRATA_RELEASE_TARGETS.join(', ')}`)
        }
        const requestedMode = parsed.values['requested-signing-mode'] ?? 'auto'
        if (requestedMode !== 'auto' && requestedMode !== 'unsigned' && requestedMode !== 'signed') {
          throw new Error('release-helper: --requested-signing-mode must be auto, unsigned, or signed')
        }
        const effectiveMode = parsed.values['effective-signing-mode'] ?? ''
        if (effectiveMode !== 'signed' && effectiveMode !== 'unsigned') {
          throw new Error('release-helper: --effective-signing-mode must be signed or unsigned')
        }
        const outDir = parsed.values['out-dir']?.trim()
        if (outDir === undefined || outDir === '') {
          throw new Error('release-helper: --out-dir is required for stage-target')
        }
        const result = stagePackagedTarget({
          repoRoot,
          target,
          buildVersion: parsed.values.version,
          requestedSigningMode: requestedMode,
          effectiveSigningMode: effectiveMode,
          skipNotarization: parsed.values['skip-notarization'],
          sourceDir: parsed.values['source-dir'],
          outDir,
          stepSummaryPath: parsed.values['step-summary'] ?? env.GITHUB_STEP_SUMMARY,
        })
        if (parsed.values.json) {
          emitOut(`${JSON.stringify(result.manifest, null, 2)}\n`)
        } else {
          emitOut(
            `Staged ${target} (${effectiveMode}): ${result.manifest.files.map(file => file.filename).join(', ')}\n`,
          )
        }
        return { exitCode: 0, stdout, stderr }
      }

      case 'collect': {
        const parsed = parseArgs({
          args: restArgs,
          options: {
            'artifacts-dir': { type: 'string' },
            'out-dir': { type: 'string' },
            targets: { type: 'string' },
            version: { type: 'string' },
            draft: { type: 'boolean', default: false },
            prerelease: { type: 'boolean', default: false },
            'github-output': { type: 'string' },
            'step-summary': { type: 'string' },
            json: { type: 'boolean', default: false },
          },
          strict: true,
        })
        const artifactsDir = parsed.values['artifacts-dir'] ?? env.ARTIFACTS_DIR ?? ''
        const outDir = parsed.values['out-dir'] ?? env.RELEASE_OUT_DIR ?? ''
        if (artifactsDir.trim() === '' || outDir.trim() === '') {
          throw new Error('release-helper: --artifacts-dir and --out-dir are required for collect')
        }
        const result = collectReleaseArtifacts({
          repoRoot,
          artifactsDir,
          outDir,
          targets: parsed.values.targets ?? env.RELEASE_TARGETS ?? 'all',
          buildVersion: parsed.values.version ?? env.RELEASE_VERSION,
          draft: parsed.values.draft || parseBooleanFlag(env.IS_DRAFT),
          prerelease: parsed.values.prerelease || parseBooleanFlag(env.IS_PRERELEASE),
          githubOutputPath: parsed.values['github-output'] ?? env.GITHUB_OUTPUT,
          stepSummaryPath: parsed.values['step-summary'] ?? env.GITHUB_STEP_SUMMARY,
        })
        if (parsed.values.json) {
          emitOut(`${JSON.stringify(result, null, 2)}\n`)
        } else {
          emitOut(
            `Collected ${String(result.assets.length)} release assets for StrataHarness ${result.buildVersion} (feedReady=${String(result.feedReady)})\n`,
          )
        }
        return { exitCode: 0, stdout, stderr }
      }

      case 'checksums': {
        const parsed = parseArgs({
          args: restArgs,
          options: {
            dir: { type: 'string' },
            'out-file': { type: 'string' },
          },
          strict: true,
        })
        const dir = parsed.values.dir?.trim()
        if (dir === undefined || dir === '') {
          throw new Error('release-helper: --dir is required for checksums')
        }
        const files = readdirSync(dir, { withFileTypes: true })
          .filter(entry => entry.isFile() && entry.name !== 'SHA256SUMS.txt')
          .map(entry => ({ filename: entry.name, filePath: join(dir, entry.name) }))
        const sums = computeSha256Sums(files)
        if (parsed.values['out-file'] !== undefined && parsed.values['out-file'].trim() !== '') {
          writeFileSync(parsed.values['out-file'], sums, 'utf8')
        }
        emitOut(sums)
        return { exitCode: 0, stdout, stderr }
      }

      default:
        throw new Error(
          `release-helper: unknown subcommand ${JSON.stringify(subcommand ?? '')}; expected preflight, stage-target, collect, or checksums`,
        )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    emitErr(`${message}\n`)
    return { exitCode: 1, stdout, stderr }
  }
}

const invokedPath = process.argv[1]
const isMain = invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href
if (isMain) {
  const result = runReleaseHelperCli(process.argv.slice(2), {
    writeStdout: chunk => process.stdout.write(chunk),
    writeStderr: chunk => process.stderr.write(chunk),
  })
  process.exitCode = result.exitCode
}
