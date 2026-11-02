/** GitHub Releases desktop updater with `SHA256SUMS.txt` verification and platform installer handoff. */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gt, lte, parse, prerelease, rcompare } from 'semver'
import { parseGitHubReleaseRepository } from './update-channel.ts'
import { assertIsolatedUpdaterRequestTarget } from './update-http-executor.ts'

const RELEASE_TAG_PREFIX = 'strata-v'
const CHECKSUMS_ASSET_NAME = 'SHA256SUMS.txt'
const DEFAULT_HTTP_IDLE_TIMEOUT_MS = 60_000
const MAX_HTTP_REDIRECTS = 5

/** Supported packaged desktop platform-architecture target identifiers. */
export type GitHubReleasePlatformTarget = 'win-x64' | 'mac-arm64' | 'mac-x64'

/** Metadata for one downloadable GitHub Release asset. */
export interface GitHubReleaseAssetDescriptor {
  /** Exact asset filename attached to the GitHub Release. */
  readonly name: string
  /** HTTPS download URL for the asset. */
  readonly browserDownloadUrl: string
  /** Optional asset byte length reported by the GitHub Releases API. */
  readonly size?: number
}

/** Validated `strata-v<version>` release entry returned by the GitHub Releases API. */
export interface GitHubReleaseCandidate {
  /** Git tag name (`strata-v<version>`). */
  readonly tagName: string
  /** Canonical SemVer version extracted from `tagName`. */
  readonly version: string
  /** Whether the release is marked as a prerelease on GitHub or carries a SemVer prerelease suffix. */
  readonly prerelease: boolean
  /** Downloadable release assets. */
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
  /** Injectable `fetch` implementation for GitHub API and asset requests. */
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

interface PreparedInstaller {
  readonly version: string
  readonly filePath: string
  readonly tempDir: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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
 * @returns Validated installer and checksum assets with signed/unsigned provenance.
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
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/u.exec(trimmed)
    if (match === null || match[1] === undefined || match[2] === undefined) continue
    const digest = match[1].toLowerCase()
    const fileName = match[2].replace(/^\.\//u, '').trim()
    if (fileName !== '') {
      entries.set(fileName, digest)
    }
  }
  return entries
}

function parseReleaseCandidates(payload: unknown, allowPrereleases: boolean): GitHubReleaseCandidate[] {
  if (!Array.isArray(payload)) {
    throw new Error('desktop update: GitHub Releases response must be a JSON array')
  }
  const candidates: GitHubReleaseCandidate[] = []
  for (const entry of payload) {
    if (!isRecord(entry)) continue
    if (entry.draft === true) continue
    if (typeof entry.tag_name !== 'string' || !entry.tag_name.startsWith(RELEASE_TAG_PREFIX)) continue
    const rawVersion = entry.tag_name.slice(RELEASE_TAG_PREFIX.length)
    const parsedVersion = parse(rawVersion, { loose: false })
    if (parsedVersion === null || parsedVersion.version !== rawVersion || parsedVersion.build.length > 0) {
      continue
    }
    const isPrerelease = entry.prerelease === true || parsedVersion.prerelease.length > 0
    if (!allowPrereleases && isPrerelease) continue

    const assets: GitHubReleaseAssetDescriptor[] = []
    if (Array.isArray(entry.assets)) {
      for (const rawAsset of entry.assets) {
        if (!isRecord(rawAsset)) continue
        if (typeof rawAsset.name !== 'string' || rawAsset.name.trim() === '') continue
        if (typeof rawAsset.browser_download_url !== 'string' || rawAsset.browser_download_url.trim() === '') continue
        const size = typeof rawAsset.size === 'number' && Number.isFinite(rawAsset.size) && rawAsset.size > 0
          ? rawAsset.size
          : undefined
        assets.push({
          name: rawAsset.name.trim(),
          browserDownloadUrl: rawAsset.browser_download_url.trim(),
          ...(size === undefined ? {} : { size }),
        })
      }
    }

    candidates.push({
      tagName: entry.tag_name,
      version: parsedVersion.version,
      prerelease: isPrerelease,
      assets,
    })
  }
  candidates.sort((left, right) => rcompare(left.version, right.version))
  return candidates
}

/**
 * `AppUpdater`-compatible desktop update provider backed by GitHub Releases and `SHA256SUMS.txt` verification.
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
   * Query the GitHub Releases API for the newest compatible `strata-v*` release.
   * @returns Update availability and target SemVer version for `DesktopUpdateCoordinator`.
   */
  async checkForUpdates(): Promise<GitHubReleaseCheckResult> {
    const installedVersion = this.currentVersion()
    const apiUrl = validateIsolatedHttpUrl(
      `https://api.github.com/repos/${this.owner}/${this.repo}/releases?per_page=20`,
      'GitHub Releases API',
    )
    const { response, clearTimer } = await this.openTimedResponse(apiUrl, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': `StrataHarness/${installedVersion}`,
      },
    })
    try {
      if (response.status === 404) {
        this.selectedRelease = undefined
        return { isUpdateAvailable: false, updateInfo: { version: installedVersion } }
      }
      if (!response.ok) {
        throw new Error(`desktop update: GitHub Releases request failed with HTTP ${String(response.status)}`)
      }
      const payload: unknown = await response.json()
      const allowPrereleases = prerelease(installedVersion) !== null && this.channel !== 'latest'
      const candidates = parseReleaseCandidates(payload, allowPrereleases)
      const bestRelease = candidates[0]
      if (bestRelease === undefined || lte(bestRelease.version, installedVersion)) {
        this.selectedRelease = undefined
        return { isUpdateAvailable: false, updateInfo: { version: installedVersion } }
      }
      if (gt(bestRelease.version, installedVersion)) {
        this.selectedRelease = bestRelease
        return { isUpdateAvailable: true, updateInfo: { version: bestRelease.version } }
      }
      this.selectedRelease = undefined
      return { isUpdateAvailable: false, updateInfo: { version: installedVersion } }
    } finally {
      clearTimer()
    }
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

    if (this.platform === 'darwin') {
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
      return
    }

    this.emit('error', new Error(`desktop update: unsupported installer platform ${this.platform}`))
  }

  private async cleanupPreparedInstaller(): Promise<void> {
    const previous = this.preparedInstaller
    this.preparedInstaller = undefined
    if (previous !== undefined) {
      await rm(previous.tempDir, { recursive: true, force: true }).catch(() => undefined)
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
    try {
      let currentUrl = url
      for (let redirectCount = 0; redirectCount <= MAX_HTTP_REDIRECTS; redirectCount += 1) {
        const response = await this.fetchImpl(currentUrl, {
          ...init,
          redirect: 'manual',
          signal: controller.signal,
        })
        refreshTimer()
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers?.get?.('location') ?? null
          if (location !== null && location.trim() !== '') {
            if (redirectCount === MAX_HTTP_REDIRECTS) {
              throw new Error(`desktop update: exceeded maximum HTTP redirects (${String(MAX_HTTP_REDIRECTS)})`)
            }
            const resolvedRedirectUrl = new URL(location, currentUrl).href
            currentUrl = validateIsolatedHttpUrl(resolvedRedirectUrl, 'redirected updater request')
            continue
          }
        }
        if (typeof response.url === 'string' && response.url.trim() !== '') {
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
        throw new Error(`desktop update: installer download failed with HTTP ${String(response.status)}`)
      }
      const contentLengthHeader = response.headers?.get?.('content-length') ?? null
      const parsedLength = contentLengthHeader !== null ? Number(contentLengthHeader) : NaN
      const totalBytes = Number.isFinite(parsedLength) && parsedLength > 0
        ? parsedLength
        : installerAsset.size

      const hash = createHash('sha256')
      let downloadedBytes = 0
      let chunkCount = 0

      const fileHandle = await open(installerPath, 'wx', 0o700)
      try {
        if (response.body !== null && response.body !== undefined && typeof response.body.getReader === 'function') {
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
    const { response, clearTimer } = await this.openTimedResponse(checksumsUrl, {
      headers: {
        Accept: 'text/plain, application/octet-stream',
        'User-Agent': `StrataHarness/${this.currentVersion()}`,
      },
    })
    try {
      if (!response.ok) {
        throw new Error(`desktop update: ${CHECKSUMS_ASSET_NAME} download failed with HTTP ${String(response.status)}`)
      }
      return await response.text()
    } finally {
      clearTimer()
    }
  }
}
