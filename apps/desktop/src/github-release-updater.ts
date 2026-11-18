/** GitHub Releases desktop updater via github.com web endpoints, `SHA256SUMS.txt` verification, and platform installer handoff. */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gt, lte, parse, prerelease, rcompare } from 'semver'
import { parseGitHubReleaseRepository } from './update-channel.ts'
import { assertIsolatedUpdaterRequestTarget } from './updates/electron-updater/http-executor.ts'

const GITHUB_ORIGIN = 'https://github.com'
const RELEASE_TAG_PREFIX = 'strata-v'
const CHECKSUMS_ASSET_NAME = 'SHA256SUMS.txt'
const DEFAULT_HTTP_IDLE_TIMEOUT_MS = 60_000
const MAX_HTTP_REDIRECTS = 5
const MAX_CANDIDATE_ASSET_PROBES = 5
const MAX_ATOM_FEED_BYTES = 2 * 1024 * 1024
const MAX_CHECKSUMS_BYTES = 64 * 1024

/** Supported packaged desktop platform-architecture target identifiers. */
export type GitHubReleasePlatformTarget = 'win-x64' | 'mac-arm64' | 'mac-x64'

/** Metadata for one downloadable GitHub Release asset. */
export interface GitHubReleaseAssetDescriptor {
  /** Exact asset filename attached to the GitHub Release. */
  readonly name: string
  /** HTTPS download URL for the asset. */
  readonly browserDownloadUrl: string
  /** Optional asset byte length reported by the release metadata. */
  readonly size?: number
}

/** Validated `strata-v<version>` release entry with verified `SHA256SUMS.txt` asset descriptors. */
export interface GitHubReleaseCandidate {
  /** Git tag name (`strata-v<version>`). */
  readonly tagName: string
  /** Canonical SemVer version extracted from `tagName`. */
  readonly version: string
  /** Whether the release is a prerelease according to SemVer or Strata release metadata. */
  readonly prerelease: boolean
  /** Downloadable release assets resolved from `SHA256SUMS.txt`. */
  readonly assets: readonly GitHubReleaseAssetDescriptor[]
}

/** Resolved platform installer and checksum manifest assets for a target release. */
export interface SelectedGitHubReleaseAssets {
  /** Resolved platform-architecture target (`win-x64`, `mac-arm64`, or `mac-x64`). */
  readonly target: GitHubReleasePlatformTarget
  /** Selected platform installer asset (`.exe` on Windows, `.dmg` on macOS). */
  readonly installerAsset: GitHubReleaseAssetDescriptor
  /** `SHA256SUMS.txt` checksum manifest asset from the same release. */
  readonly checksumsAsset: GitHubReleaseAssetDescriptor
  /** `true` when the signed installer artifact was selected; `false` when falling back to `-unsigned`. */
  readonly signed: boolean
}

/** Result returned by {@link GitHubReleaseUpdater.checkForUpdates}. */
export interface GitHubReleaseCheckResult {
  /** Whether a newer release is available for download. */
  readonly isUpdateAvailable: boolean
  /** Selected release metadata (or the current version when up to date). */
  readonly updateInfo: {
    /** Canonical SemVer string. */
    readonly version: string
  }
}

/** Minimal child-process handle returned by the Windows installer launcher. */
export interface SpawnedInstallerProcess {
  /**
   * Unreference the child process from the parent event loop.
   */
  unref(): void
  /**
   * Subscribe to a one-time child-process lifecycle event (`'spawn'` or `'error'`).
   * @param event - Child-process lifecycle event name.
   * @param listener - Callback invoked when the event fires.
   * @returns The child process handle.
   */
  once?(event: 'spawn' | 'error', listener: (...args: unknown[]) => void): unknown
  /**
   * Remove a previously registered child-process lifecycle listener.
   * @param event - Child-process lifecycle event name.
   * @param listener - Previously registered callback.
   * @returns The child process handle.
   */
  removeListener?(event: 'spawn' | 'error', listener: (...args: unknown[]) => void): unknown
}

/** Injectable Windows installer process launcher signature compatible with `child_process.spawn`. */
export type SpawnInstallerProcess = (
  command: string,
  args: readonly string[],
  options: {
    readonly detached: true
    readonly stdio: 'ignore'
    readonly windowsHide: false
  },
) => SpawnedInstallerProcess

/** Configuration and injectable platform seams for {@link GitHubReleaseUpdater}. */
export interface GitHubReleaseUpdaterOptions {
  /** Canonical HTTPS GitHub repository URL (`https://github.com/<owner>/<repo>[.git]`). */
  readonly repository: string
  /** Callback returning the currently installed application SemVer version. */
  readonly currentVersion: () => string
  /** Operating system platform; defaults to `process.platform`. */
  readonly platform?: NodeJS.Platform
  /** CPU architecture; defaults to `process.arch`. */
  readonly arch?: string
  /** HTTP request inactivity timeout in milliseconds; defaults to `DSH_DESKTOP_UPDATE_HTTP_IDLE_TIMEOUT_MS` or `60_000`. */
  readonly timeoutMs?: number
  /** Injectable `fetch` implementation for GitHub web release and asset requests. */
  readonly fetch?: typeof globalThis.fetch
  /** Injectable child-process `spawn` implementation for Windows `.exe` installer launch. */
  readonly spawn?: SpawnInstallerProcess
  /** Injectable macOS `.dmg` opener (`shell.openPath`), returning `""` on success or an error message. */
  readonly openInstaller?: (filePath: string) => Promise<string>
  /** Injectable application quit callback (`() => app.quit()`) invoked after installer handoff. */
  readonly quit?: () => void
  /** Base temporary directory for downloaded installers; defaults to `os.tmpdir()`. */
  readonly tempRootDir?: string
}

interface GitHubReleaseTagCandidate {
  readonly tagName: string
  readonly version: string
  readonly prerelease: boolean
}

interface PreparedInstaller {
  readonly version: string
  readonly filePath: string
  readonly tempDir: string
}

type LatestStableProbeResult =
  | { readonly kind: 'none' }
  | { readonly kind: 'fallback-atom' }
  | { readonly kind: 'tag'; readonly candidate: GitHubReleaseTagCandidate }

function validateIsolatedHttpUrl(rawUrl: string, label: string): string {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch (_invalid) {
    throw new Error(`desktop update: invalid ${label} URL ${JSON.stringify(rawUrl)}`)
  }
  assertIsolatedUpdaterRequestTarget({
    url: parsed.href,
    hostname: parsed.hostname,
    host: parsed.host,
  })
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'))) {
    throw new Error(`desktop update: ${label} must use HTTPS (${parsed.href})`)
  }
  return parsed.href
}

function resolveIsolatedRedirectUrl(location: string, baseUrl: string, label: string): string {
  let resolved: URL
  try {
    resolved = new URL(location, baseUrl)
  } catch (_invalidRedirect) {
    throw new Error(`desktop update: invalid ${label} URL ${JSON.stringify(location)}`)
  }
  return validateIsolatedHttpUrl(resolved.href, label)
}

async function cancelResponseBody(response: Response): Promise<void> {
  if (response.body === null) return
  try {
    await response.body.cancel()
  } catch (_cancelError) {
    // Discard unread stream cancellation errors when closing probe responses early.
  }
}

async function readBoundedUtf8Text(
  response: Response,
  refreshTimer: () => void,
  maxBytes: number,
  label: string,
): Promise<string> {
  if (response.body !== null) {
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let totalBytes = 0
    for (;;) {
      const { done, value } = await reader.read()
      refreshTimer()
      if (done) break
      if (value.byteLength === 0) continue
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        /* v8 ignore next -- best-effort stream cancel after exceeding metadata byte limit */
        await reader.cancel().catch(() => undefined)
        throw new Error(`desktop update: ${label} exceeded maximum size (${String(maxBytes)} bytes)`)
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString('utf8')
  }
  const text = await response.text()
  refreshTimer()
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new Error(`desktop update: ${label} exceeded maximum size (${String(maxBytes)} bytes)`)
  }
  return text
}

function parseStrataReleaseTag(tagName: string): GitHubReleaseTagCandidate | undefined {
  if (!tagName.startsWith(RELEASE_TAG_PREFIX)) return undefined
  const rawVersion = tagName.slice(RELEASE_TAG_PREFIX.length)
  const parsedVersion = parse(rawVersion, { loose: false })
  if (parsedVersion === null || parsedVersion.version !== rawVersion || parsedVersion.build.length > 0) {
    return undefined
  }
  return {
    tagName,
    version: parsedVersion.version,
    prerelease: parsedVersion.prerelease.length > 0,
  }
}

function isSafeReleaseAssetFileName(fileName: string): boolean {
  if (fileName === '' || fileName === '.' || fileName === '..') return false
  if (fileName.includes('/') || fileName.includes('\\')) return false
  return !/[\u0000-\u001f\u007f]/u.test(fileName)
}

function stripGitHubRepositoryPrefix(pathname: string, owner: string, repo: string): string | undefined {
  const firstSlash = pathname.indexOf('/', 1)
  if (firstSlash === -1) return undefined
  const secondSlash = pathname.indexOf('/', firstSlash + 1)
  if (secondSlash === -1) return undefined
  const pathOwner = pathname.slice(1, firstSlash)
  const pathRepo = pathname.slice(firstSlash + 1, secondSlash)
  if (pathOwner.toLowerCase() !== owner.toLowerCase() || pathRepo.toLowerCase() !== repo.toLowerCase()) {
    return undefined
  }
  return pathname.slice(secondSlash)
}

function parseGitHubReleaseTagPathname(
  pathname: string,
  owner: string,
  repo: string,
): { readonly kind: 'not-tag' } | { readonly kind: 'invalid-tag' } | { readonly kind: 'tag'; readonly candidate: GitHubReleaseTagCandidate } {
  const repoPath = stripGitHubRepositoryPrefix(pathname, owner, repo)
  if (repoPath === undefined) return { kind: 'not-tag' }
  const tagMatch = /^\/releases\/tag\/([^/?#]+)\/?$/u.exec(repoPath)
  const rawTag = tagMatch?.[1]
  if (rawTag === undefined) return { kind: 'not-tag' }
  let decodedTag: string
  try {
    decodedTag = decodeURIComponent(rawTag)
  } catch (_invalidEncoding) {
    return { kind: 'invalid-tag' }
  }
  const candidate = parseStrataReleaseTag(decodedTag)
  return candidate === undefined ? { kind: 'invalid-tag' } : { kind: 'tag', candidate }
}

function classifyLatestReleaseUrl(rawUrl: string, owner: string, repo: string): LatestStableProbeResult | undefined {
  const parsedUrl = new URL(rawUrl)
  if (parsedUrl.hostname.toLowerCase() !== 'github.com') return undefined

  const tagResult = parseGitHubReleaseTagPathname(parsedUrl.pathname, owner, repo)
  if (tagResult.kind === 'tag') {
    return tagResult.candidate.prerelease ? { kind: 'fallback-atom' } : { kind: 'tag', candidate: tagResult.candidate }
  }
  if (tagResult.kind === 'invalid-tag') {
    return { kind: 'fallback-atom' }
  }

  const repoPath = stripGitHubRepositoryPrefix(parsedUrl.pathname, owner, repo)
  if (repoPath !== undefined && /^\/releases\/?$/u.test(repoPath)) {
    return { kind: 'none' }
  }
  return undefined
}

function parseReleasesAtomCandidates(
  atomXml: string,
  owner: string,
  repo: string,
  allowPrereleases: boolean,
): readonly GitHubReleaseTagCandidate[] {
  if (!/<feed[\s>]/u.test(atomXml)) {
    throw new Error('desktop update: GitHub Releases Atom feed is invalid XML')
  }

  const candidates: GitHubReleaseTagCandidate[] = []
  const seenVersions = new Set<string>()
  for (const entryMatch of atomXml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gu)) {
    const entryOpenEnd = entryMatch[0].indexOf('>')
    const entryBody = entryMatch[0].slice(entryOpenEnd + 1, -'</entry>'.length)
    const hasPrereleaseMetadata = /(?:&lt;li&gt;|<li>|-\s*)Release Channel:\s*(?:Prerelease|Draft)\b/iu.test(entryBody)
    const strippedBody = entryBody
      .replace(/<(?:content|summary)\b[^>]*\/>/gu, '')
      .replace(/<content\b[^>]*>[\s\S]*?<\/content>/gu, '')
      .replace(/<summary\b[^>]*>[\s\S]*?<\/summary>/gu, '')

    for (const linkMatch of strippedBody.matchAll(/<link\b[^>]*>/gu)) {
      const relMatch = /\brel\s*=\s*(?:"([^"]*)"|'([^']*)')/u.exec(linkMatch[0])
      if (relMatch !== null) {
        const relValue = relMatch[1] ?? relMatch[2]
        if (relValue !== 'alternate') continue
      }

      const hrefMatch = /\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')/u.exec(linkMatch[0])
      const rawHref = hrefMatch?.[1] ?? hrefMatch?.[2]
      if (rawHref === undefined) continue

      const decodedHref = rawHref.replaceAll('&amp;', '&')
      let parsedUrl: URL
      try {
        parsedUrl = new URL(decodedHref, GITHUB_ORIGIN)
      } catch (_invalidUrl) {
        continue
      }
      if (parsedUrl.hostname.toLowerCase() !== 'github.com') continue

      const tagResult = parseGitHubReleaseTagPathname(parsedUrl.pathname, owner, repo)
      if (tagResult.kind !== 'tag') continue
      const isPrerelease = tagResult.candidate.prerelease || hasPrereleaseMetadata
      if (!allowPrereleases && isPrerelease) continue
      if (seenVersions.has(tagResult.candidate.version)) continue

      seenVersions.add(tagResult.candidate.version)
      candidates.push({
        tagName: tagResult.candidate.tagName,
        version: tagResult.candidate.version,
        prerelease: isPrerelease,
      })
      break
    }
  }

  candidates.sort((left, right) => rcompare(left.version, right.version))
  return candidates
}

function buildGitHubReleaseAssetsFromChecksums(
  owner: string,
  repo: string,
  version: string,
  checksumsContent: string,
): readonly GitHubReleaseAssetDescriptor[] {
  const checksums = parseSha256Sums(checksumsContent)
  const releaseBaseUrl = `${GITHUB_ORIGIN}/${owner}/${repo}/releases/download/${RELEASE_TAG_PREFIX}${version}`
  const assets: GitHubReleaseAssetDescriptor[] = []
  let hasChecksumsAsset = false

  for (const fileName of checksums.keys()) {
    if (!isSafeReleaseAssetFileName(fileName)) continue
    if (fileName === CHECKSUMS_ASSET_NAME) {
      hasChecksumsAsset = true
    }
    assets.push({
      name: fileName,
      browserDownloadUrl: `${releaseBaseUrl}/${encodeURIComponent(fileName)}`,
    })
  }

  if (assets.length > 0 && !hasChecksumsAsset) {
    assets.push({
      name: CHECKSUMS_ASSET_NAME,
      browserDownloadUrl: `${releaseBaseUrl}/${CHECKSUMS_ASSET_NAME}`,
    })
  }
  return assets
}

/**
 * Map a runtime platform and architecture pair to its StrataHarness release target and installer extension.
 * @param platform - Node.js platform identifier (`win32` or `darwin`).
 * @param arch - CPU architecture (`x64` or `arm64`).
 * @returns Target identifier (`win-x64`, `mac-arm64`, or `mac-x64`) and installer file extension (`exe` or `dmg`).
 */
export function resolveGitHubReleasePlatformTarget(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): { readonly target: GitHubReleasePlatformTarget; readonly extension: 'exe' | 'dmg' } {
  if (platform === 'win32' && arch === 'x64') {
    return { target: 'win-x64', extension: 'exe' }
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return { target: 'mac-arm64', extension: 'dmg' }
  }
  if (platform === 'darwin' && arch === 'x64') {
    return { target: 'mac-x64', extension: 'dmg' }
  }
  throw new Error(`desktop update: unsupported platform target ${platform}-${arch}`)
}

/**
 * Select the platform installer asset (preferring signed over `-unsigned`) and `SHA256SUMS.txt` from a release.
 * @param version - Release SemVer string without the `strata-v` prefix.
 * @param assets - Assets attached to the GitHub Release.
 * @param platform - Target OS platform (`win32` or `darwin`).
 * @param arch - Target CPU architecture (`x64` or `arm64`).
 * @returns Validated installer and checksum assets with signed/unsigned signature status.
 */
export function selectGitHubReleaseAssets(
  version: string,
  assets: readonly GitHubReleaseAssetDescriptor[],
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): SelectedGitHubReleaseAssets {
  const { target, extension } = resolveGitHubReleasePlatformTarget(platform, arch)
  const signedFileName = `strataharness-${version}-${target}.${extension}`
  const unsignedFileName = `strataharness-${version}-${target}-unsigned.${extension}`

  const signedAsset = assets.find(asset => asset.name === signedFileName)
  const unsignedAsset = assets.find(asset => asset.name === unsignedFileName)
  const installerAsset = signedAsset ?? unsignedAsset
  if (installerAsset === undefined) {
    throw new Error(
      `desktop update: release ${RELEASE_TAG_PREFIX}${version} is missing installer asset (${signedFileName} or ${unsignedFileName})`,
    )
  }

  const checksumsAsset = assets.find(asset => asset.name === CHECKSUMS_ASSET_NAME)
  if (checksumsAsset === undefined) {
    throw new Error(`desktop update: release ${RELEASE_TAG_PREFIX}${version} is missing ${CHECKSUMS_ASSET_NAME}`)
  }

  validateIsolatedHttpUrl(installerAsset.browserDownloadUrl, `installer asset ${installerAsset.name}`)
  validateIsolatedHttpUrl(checksumsAsset.browserDownloadUrl, CHECKSUMS_ASSET_NAME)

  return {
    target,
    installerAsset,
    checksumsAsset,
    signed: signedAsset !== undefined,
  }
}

/**
 * Parse a `SHA256SUMS.txt` manifest into a map from filename to lowercase 64-character hex digest.
 * @param content - Raw UTF-8 text of `SHA256SUMS.txt`.
 * @returns Map of artifact filename to lowercase SHA-256 hex digest.
 */
export function parseSha256Sums(content: string): ReadonlyMap<string, string> {
  const entries = new Map<string, string>()
  for (const rawLine of content.split(/\r?\n/u)) {
    const trimmed = rawLine.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    if (!/^[0-9a-fA-F]{64}\s+\*?.+$/u.test(trimmed)) continue
    const digest = trimmed.slice(0, 64).toLowerCase()
    const fileName = trimmed.slice(64).trimStart().replace(/^\*/u, '').replace(/^\.\//u, '').trim()
    if (fileName !== '') {
      entries.set(fileName, digest)
    }
  }
  return entries
}

/**
 * `AppUpdater`-compatible desktop update provider backed by `github.com` web release endpoints and `SHA256SUMS.txt` verification.
 */
export class GitHubReleaseUpdater extends EventEmitter {
  /** Configured by `DesktopUpdateCoordinator`; downloads are always explicitly user-authorized. */
  autoDownload = false
  /** Configured by `DesktopUpdateCoordinator`; installation requires explicit user confirmation. */
  autoInstallOnAppQuit = false
  /** Active update channel assigned by `DesktopUpdateCoordinator`. */
  channel: string | null = 'nightly'
  /** Configured by `DesktopUpdateCoordinator`; prerelease eligibility is governed by installed version stability. */
  allowPrerelease = false
  /** Configured by `DesktopUpdateCoordinator`; downgrades are never permitted. */
  allowDowngrade = false

  private readonly owner: string
  private readonly repo: string
  private readonly currentVersion: () => string
  private readonly platform: NodeJS.Platform
  private readonly arch: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly spawnImpl: SpawnInstallerProcess
  private readonly openInstaller: (filePath: string) => Promise<string>
  private readonly quit: () => void
  private readonly tempRootDir: string

  private selectedRelease: GitHubReleaseCandidate | undefined
  private preparedInstaller: PreparedInstaller | undefined

  /**
   * @param options - Repository URL, version provider, and injectable platform/network hooks.
   */
  constructor(options: GitHubReleaseUpdaterOptions) {
    super()
    assertIsolatedUpdaterRequestTarget({ url: options.repository })
    const parsedRepo = parseGitHubReleaseRepository(options.repository)
    if (parsedRepo === undefined) {
      throw new Error(`desktop update: invalid GitHub release repository ${JSON.stringify(options.repository)}`)
    }
    const timeoutMs = options.timeoutMs ?? Number(process.env.DSH_DESKTOP_UPDATE_HTTP_IDLE_TIMEOUT_MS ?? DEFAULT_HTTP_IDLE_TIMEOUT_MS)
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 2_147_483_647) {
      throw new Error('desktop update: HTTP idle timeout must be an integer from 1000 through 2147483647')
    }
    this.owner = parsedRepo.owner
    this.repo = parsedRepo.repo
    this.currentVersion = options.currentVersion
    this.platform = options.platform ?? process.platform
    this.arch = options.arch ?? process.arch
    this.timeoutMs = timeoutMs
    this.fetchImpl = options.fetch ?? globalThis.fetch
    this.spawnImpl = options.spawn ?? spawn
    this.openInstaller = options.openInstaller ?? (() => Promise.reject(new Error('desktop update: macOS installer opener is not configured')))
    this.quit = options.quit ?? (() => undefined)
    this.tempRootDir = options.tempRootDir ?? tmpdir()
  }

  /**
   * Path to the downloaded and SHA-256-verified installer file when ready for installation.
   * @returns Verified temporary file path, or `undefined` when no verified installer is staged.
   */
  get preparedInstallerPath(): string | undefined {
    return this.preparedInstaller?.filePath
  }

  /**
   * Query `github.com` web release feeds and `SHA256SUMS.txt` for the newest installable `strata-v*` release.
   * @returns Update availability and target SemVer version for `DesktopUpdateCoordinator`.
   */
  async checkForUpdates(): Promise<GitHubReleaseCheckResult> {
    const installedVersion = this.currentVersion()
    const allowPrereleases = prerelease(installedVersion) !== null && this.channel !== 'stable'
    const checkedVersions = new Set<string>()
    let maxStableVersion: string | undefined
    let probesUsed = 0

    if (!allowPrereleases) {
      const probe = await this.probeLatestStableRelease(installedVersion)
      if (probe.kind === 'none') {
        this.selectedRelease = undefined
        return { isUpdateAvailable: false, updateInfo: { version: installedVersion } }
      }
      if (probe.kind === 'tag') {
        if (lte(probe.candidate.version, installedVersion)) {
          this.selectedRelease = undefined
          return { isUpdateAvailable: false, updateInfo: { version: installedVersion } }
        }
        maxStableVersion = probe.candidate.version
        checkedVersions.add(probe.candidate.version)
        probesUsed += 1
        const verified = await this.tryResolveVerifiedCandidate(probe.candidate, installedVersion)
        if (verified !== undefined) {
          this.selectedRelease = verified
          return { isUpdateAvailable: true, updateInfo: { version: verified.version } }
        }
      }
    }

    const atomUrl = validateIsolatedHttpUrl(
      `${GITHUB_ORIGIN}/${this.owner}/${this.repo}/releases.atom`,
      'GitHub Releases Atom feed',
    )
    const { response, refreshTimer, clearTimer } = await this.openTimedResponse(atomUrl, {
      headers: {
        Accept: 'application/atom+xml, application/xml, text/xml',
        'User-Agent': `StrataHarness/${installedVersion}`,
      },
    })
    let atomXml: string
    try {
      if (response.status === 404) {
        await cancelResponseBody(response)
        this.selectedRelease = undefined
        return { isUpdateAvailable: false, updateInfo: { version: installedVersion } }
      }
      if (!response.ok) {
        await cancelResponseBody(response)
        throw new Error(`desktop update: GitHub Releases request failed with HTTP ${String(response.status)}`)
      }
      atomXml = await readBoundedUtf8Text(response, refreshTimer, MAX_ATOM_FEED_BYTES, 'GitHub Releases Atom feed')
    } finally {
      clearTimer()
    }

    const candidates = parseReleasesAtomCandidates(atomXml, this.owner, this.repo, allowPrereleases)
    for (const candidate of candidates) {
      if (lte(candidate.version, installedVersion)) break
      if (maxStableVersion !== undefined && gt(candidate.version, maxStableVersion)) continue
      if (checkedVersions.has(candidate.version)) continue
      if (probesUsed >= MAX_CANDIDATE_ASSET_PROBES) break
      probesUsed += 1
      const verified = await this.tryResolveVerifiedCandidate(candidate, installedVersion)
      if (verified !== undefined) {
        this.selectedRelease = verified
        return { isUpdateAvailable: true, updateInfo: { version: verified.version } }
      }
    }

    this.selectedRelease = undefined
    return { isUpdateAvailable: false, updateInfo: { version: installedVersion } }
  }

  /**
   * Download the selected release's platform installer into a temporary directory and verify its SHA-256 against `SHA256SUMS.txt`.
   * @returns Array containing the verified local installer path.
   */
  async downloadUpdate(): Promise<string[]> {
    await this.cleanupPreparedInstaller()

    let release = this.selectedRelease
    if (release === undefined) {
      await this.checkForUpdates()
      release = this.selectedRelease
    }
    if (release === undefined) {
      throw new Error('desktop update: no GitHub release is available to download')
    }

    const { installerAsset, checksumsAsset } = selectGitHubReleaseAssets(
      release.version,
      release.assets,
      this.platform,
      this.arch,
    )

    const tempDir = await mkdtemp(join(this.tempRootDir, 'strataharness-update-'))
    const installerPath = join(tempDir, installerAsset.name)

    try {
      this.emit('download-progress', { percent: 0 })
      const actualSha256 = await this.downloadInstallerToFile(installerAsset, installerPath)
      this.emit('download-progress', { percent: 100 })

      const checksumsText = await this.downloadChecksumsText(checksumsAsset.browserDownloadUrl)
      const checksums = parseSha256Sums(checksumsText)
      const expectedSha256 = checksums.get(installerAsset.name)
      if (expectedSha256 === undefined) {
        throw new Error(`desktop update: ${CHECKSUMS_ASSET_NAME} does not contain an entry for ${installerAsset.name}`)
      }
      if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
        throw new Error(
          `desktop update: SHA-256 verification failed for ${installerAsset.name} (expected ${expectedSha256}, got ${actualSha256})`,
        )
      }

      this.preparedInstaller = {
        version: release.version,
        filePath: installerPath,
        tempDir,
      }
      this.emit('update-downloaded', { version: release.version })
      return [installerPath]
    } catch (error) {
      this.preparedInstaller = undefined
      /* v8 ignore next -- best-effort temporary directory cleanup after download failure */
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  /**
   * Launch the verified installer (`.exe` on Windows) or open the verified disk image (`.dmg` on macOS) and quit the application.
   * @param _isSilent - Unused `electron-updater` compatibility flag.
   * @param _isForceRunAfter - Unused `electron-updater` compatibility flag.
   */
  quitAndInstall(_isSilent?: boolean, _isForceRunAfter?: boolean): void {
    const prepared = this.preparedInstaller
    if (prepared === undefined) {
      this.emit('error', new Error('desktop update: no verified installer is ready to launch'))
      return
    }

    if (this.platform === 'win32') {
      try {
        const child = this.spawnImpl(prepared.filePath, [], {
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
        })
        let settled = false
        const onError = (error: unknown): void => {
          if (settled) return
          settled = true
          child.removeListener?.('spawn', onSpawn)
          this.emit('error', error instanceof Error ? error : new Error(String(error)))
        }
        const onSpawn = (): void => {
          if (settled) return
          settled = true
          child.removeListener?.('error', onError)
          child.unref()
          this.quit()
        }
        if (typeof child.once === 'function') {
          child.once('error', onError)
          child.once('spawn', onSpawn)
        } else {
          child.unref()
          this.quit()
        }
      } catch (error) {
        this.emit('error', error instanceof Error ? error : new Error(String(error)))
      }
      return
    }

    void Promise.resolve()
      .then(() => this.openInstaller(prepared.filePath))
      .then((errorMessage) => {
        if (errorMessage !== '') {
          this.emit('error', new Error(`desktop update: failed to open ${prepared.filePath}: ${errorMessage}`))
          return
        }
        this.quit()
      })
      .catch((error: unknown) => {
        this.emit('error', error instanceof Error ? error : new Error(String(error)))
      })
  }

  /**
   * Discard any previously checked release selection or staged installer before a channel switch.
   * @returns Resolves after the temporary download directory has been cleaned up.
   */
  async discard(): Promise<void> {
    this.selectedRelease = undefined
    await this.cleanupPreparedInstaller()
  }

  private async cleanupPreparedInstaller(): Promise<void> {
    const previous = this.preparedInstaller
    this.preparedInstaller = undefined
    if (previous !== undefined) {
      /* v8 ignore next -- best-effort cleanup when retiring staged installer */
      await rm(previous.tempDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private createIdleTimer(): {
    readonly signal: AbortSignal
    readonly refreshTimer: () => void
    readonly clearTimer: () => void
  } {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const clearTimer = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
    }
    const refreshTimer = (): void => {
      clearTimer()
      timer = setTimeout(() => {
        controller.abort(Object.assign(new Error('Desktop update connection timed out'), { code: 'ETIMEDOUT' }))
      }, this.timeoutMs)
    }
    refreshTimer()
    return { signal: controller.signal, refreshTimer, clearTimer }
  }

  private async probeLatestStableRelease(installedVersion: string): Promise<LatestStableProbeResult> {
    let currentUrl = validateIsolatedHttpUrl(
      `${GITHUB_ORIGIN}/${this.owner}/${this.repo}/releases/latest`,
      'GitHub latest release',
    )
    const timer = this.createIdleTimer()
    try {
      for (let redirectCount = 0; redirectCount <= MAX_HTTP_REDIRECTS; redirectCount += 1) {
        const response = await this.fetchImpl(currentUrl, {
          headers: {
            Accept: 'text/html,application/xhtml+xml',
            'User-Agent': `StrataHarness/${installedVersion}`,
          },
          redirect: 'manual',
          signal: timer.signal,
        })
        timer.refreshTimer()
        if (response.status === 404) {
          await cancelResponseBody(response)
          return { kind: 'none' }
        }
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location')
          await cancelResponseBody(response)
          if (location === null || location.trim() === '') {
            throw new Error('desktop update: GitHub latest release redirect is missing Location header')
          }
          const resolvedUrl = resolveIsolatedRedirectUrl(location, currentUrl, 'redirected updater request')
          const classified = classifyLatestReleaseUrl(resolvedUrl, this.owner, this.repo)
          if (classified !== undefined) {
            return classified
          }
          if (redirectCount < MAX_HTTP_REDIRECTS) {
            currentUrl = resolvedUrl
            continue
          }
          break
        }
        await cancelResponseBody(response)
        if (!response.ok) {
          throw new Error(`desktop update: GitHub Releases request failed with HTTP ${String(response.status)}`)
        }
        if (response.url.trim() !== '') {
          const finalUrl = validateIsolatedHttpUrl(response.url, 'redirected updater response')
          const classified = classifyLatestReleaseUrl(finalUrl, this.owner, this.repo)
          if (classified !== undefined) {
            return classified
          }
        }
        throw new Error('desktop update: unexpected response from GitHub latest release endpoint')
      }
      throw new Error(`desktop update: exceeded maximum HTTP redirects (${String(MAX_HTTP_REDIRECTS)})`)
    } finally {
      timer.clearTimer()
    }
  }

  private async tryResolveVerifiedCandidate(
    candidate: GitHubReleaseTagCandidate,
    installedVersion: string,
  ): Promise<GitHubReleaseCandidate | undefined> {
    const { target, extension } = resolveGitHubReleasePlatformTarget(this.platform, this.arch)
    const checksumsUrl = validateIsolatedHttpUrl(
      `${GITHUB_ORIGIN}/${this.owner}/${this.repo}/releases/download/${candidate.tagName}/${CHECKSUMS_ASSET_NAME}`,
      CHECKSUMS_ASSET_NAME,
    )
    const { response, refreshTimer, clearTimer } = await this.openTimedResponse(checksumsUrl, {
      headers: {
        Accept: 'text/plain, application/octet-stream',
        'User-Agent': `StrataHarness/${installedVersion}`,
      },
    })
    let checksumsText: string
    try {
      if (response.status === 404) {
        await cancelResponseBody(response)
        return undefined
      }
      if (!response.ok) {
        await cancelResponseBody(response)
        throw new Error(`desktop update: ${CHECKSUMS_ASSET_NAME} request failed with HTTP ${String(response.status)}`)
      }
      checksumsText = await readBoundedUtf8Text(response, refreshTimer, MAX_CHECKSUMS_BYTES, CHECKSUMS_ASSET_NAME)
    } finally {
      clearTimer()
    }

    const assets = buildGitHubReleaseAssetsFromChecksums(this.owner, this.repo, candidate.version, checksumsText)
    const signedFileName = `strataharness-${candidate.version}-${target}.${extension}`
    const unsignedFileName = `strataharness-${candidate.version}-${target}-unsigned.${extension}`
    if (!assets.some(asset => asset.name === signedFileName || asset.name === unsignedFileName)) {
      return undefined
    }
    selectGitHubReleaseAssets(candidate.version, assets, this.platform, this.arch)
    return {
      tagName: candidate.tagName,
      version: candidate.version,
      prerelease: candidate.prerelease,
      assets,
    }
  }

  private async openTimedResponse(
    url: string,
    init: RequestInit,
  ): Promise<{
    readonly response: Response
    readonly refreshTimer: () => void
    readonly clearTimer: () => void
  }> {
    validateIsolatedHttpUrl(url, 'updater request')
    const { signal, refreshTimer, clearTimer } = this.createIdleTimer()
    try {
      let currentUrl = url
      for (let redirectCount = 0; redirectCount <= MAX_HTTP_REDIRECTS; redirectCount += 1) {
        const response = await this.fetchImpl(currentUrl, {
          ...init,
          redirect: 'manual',
          signal,
        })
        refreshTimer()
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location')
          if (location !== null && location.trim() !== '') {
            await cancelResponseBody(response)
            if (redirectCount < MAX_HTTP_REDIRECTS) {
              currentUrl = resolveIsolatedRedirectUrl(location, currentUrl, 'redirected updater request')
              continue
            }
            break
          }
        }
        if (response.url.trim() !== '') {
          validateIsolatedHttpUrl(response.url, 'redirected updater response')
        }
        return { response, refreshTimer, clearTimer }
      }
      throw new Error(`desktop update: exceeded maximum HTTP redirects (${String(MAX_HTTP_REDIRECTS)})`)
    } catch (error) {
      clearTimer()
      throw error
    }
  }

  private async downloadInstallerToFile(
    installerAsset: GitHubReleaseAssetDescriptor,
    installerPath: string,
  ): Promise<string> {
    const { response, refreshTimer, clearTimer } = await this.openTimedResponse(installerAsset.browserDownloadUrl, {
      headers: {
        Accept: 'application/octet-stream',
        'User-Agent': `StrataHarness/${this.currentVersion()}`,
      },
    })
    try {
      if (!response.ok) {
        await cancelResponseBody(response)
        throw new Error(`desktop update: installer download failed with HTTP ${String(response.status)}`)
      }
      const contentLengthHeader = response.headers.get('content-length')
      const parsedLength = contentLengthHeader !== null ? Number(contentLengthHeader) : NaN
      const totalBytes = Number.isFinite(parsedLength) && parsedLength > 0
        ? parsedLength
        : installerAsset.size

      const hash = createHash('sha256')
      let downloadedBytes = 0
      let chunkCount = 0

      const fileHandle = await open(installerPath, 'wx', 0o700)
      try {
        if (response.body !== null) {
          const reader = response.body.getReader()
          for (;;) {
            const { done, value } = await reader.read()
            refreshTimer()
            if (done) break
            if (value.byteLength === 0) continue
            hash.update(value)
            await fileHandle.write(value)
            downloadedBytes += value.byteLength
            chunkCount += 1
            const percent = totalBytes !== undefined && totalBytes > 0
              ? Math.min(99, Math.max(0, Math.floor((downloadedBytes / totalBytes) * 100)))
              : Math.min(99, chunkCount)
            this.emit('download-progress', { percent })
          }
        } else {
          const bytes = new Uint8Array(await response.arrayBuffer())
          refreshTimer()
          if (bytes.byteLength > 0) {
            hash.update(bytes)
            await fileHandle.write(bytes)
            downloadedBytes += bytes.byteLength
            this.emit('download-progress', { percent: 99 })
          }
        }
      } finally {
        /* v8 ignore next -- best-effort descriptor close after stream write */
        await fileHandle.close().catch(() => undefined)
      }

      if (downloadedBytes === 0) {
        throw new Error(`desktop update: downloaded installer ${installerAsset.name} is empty`)
      }
      return hash.digest('hex').toLowerCase()
    } finally {
      clearTimer()
    }
  }

  private async downloadChecksumsText(checksumsUrl: string): Promise<string> {
    const { response, refreshTimer, clearTimer } = await this.openTimedResponse(checksumsUrl, {
      headers: {
        Accept: 'text/plain, application/octet-stream',
        'User-Agent': `StrataHarness/${this.currentVersion()}`,
      },
    })
    try {
      if (!response.ok) {
        await cancelResponseBody(response)
        throw new Error(`desktop update: ${CHECKSUMS_ASSET_NAME} download failed with HTTP ${String(response.status)}`)
      }
      return await readBoundedUtf8Text(response, refreshTimer, MAX_CHECKSUMS_BYTES, CHECKSUMS_ASSET_NAME)
    } finally {
      clearTimer()
    }
  }
}
