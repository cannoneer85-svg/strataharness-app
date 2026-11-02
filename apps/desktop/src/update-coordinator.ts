/** User-authorized downloads and separate installation of one version-bound Desktop release. */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import electronUpdater, { type AppUpdater } from 'electron-updater'
import { gt, valid } from 'semver'
import { GitHubReleaseUpdater, type SpawnInstallerProcess } from './github-release-updater.ts'
import type { DesktopUpdateState } from './ipc.ts'
import { desktopReleaseRepository } from './update-channel.ts'
import { DesktopUpdateHttpExecutor } from './update-http-executor.ts'
import { DesktopUpdatePreparationError } from './update-error.ts'

const { autoUpdater } = electronUpdater

/** Progress payload emitted during installer download and verification. */
export interface DesktopUpdaterProgress {
  /** Download completion percentage (`0` through `100`). */
  readonly percent: number
}

/** Downloaded release metadata emitted once platform verification succeeds. */
export interface DesktopUpdaterDownloadedInfo {
  /** Verified SemVer release version. */
  readonly version: string
}

/** Result returned by an updater check. */
export interface DesktopUpdaterCheckResult {
  /** Whether a newer release is available. */
  readonly isUpdateAvailable?: boolean
  /** Release metadata reported by the update feed. */
  readonly updateInfo: {
    /** Canonical SemVer version string. */
    readonly version: string
  }
}

/** Updater contract shared by `electron-updater` and `GitHubReleaseUpdater`. */
export interface DesktopAppUpdater {
  /** Whether updates download automatically on check; always set to `false` by `DesktopUpdateCoordinator`. */
  autoDownload: boolean
  /** Whether updates install automatically on app quit; always set to `false` by `DesktopUpdateCoordinator`. */
  autoInstallOnAppQuit: boolean
  /** Active update channel (`'nightly'` or `'latest'`). */
  channel: string | null
  /** Whether prerelease versions are eligible on the active channel. */
  allowPrerelease: boolean
  /** Whether version downgrades are permitted; always set to `false` by `DesktopUpdateCoordinator`. */
  allowDowngrade: boolean
  /**
   * Check the configured update source for a newer version without downloading it.
   * @returns Check result or `null` when no result was returned.
   */
  checkForUpdates(): Promise<DesktopUpdaterCheckResult | null>
  /**
   * Download and verify the candidate update artifact.
   * @returns Resolved download artifact descriptor(s).
   */
  downloadUpdate(): Promise<unknown>
  /**
   * Launch the verified installer or disk image and quit the application.
   * @param isSilent - Whether to run the installer silently on supported platforms.
   * @param isForceRunAfter - Whether to relaunch the application after installation.
   */
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  /**
   * Subscribe to download progress updates.
   * @param event - Progress event name.
   * @param listener - Progress callback.
   * @returns The updater instance.
   */
  on(event: 'download-progress', listener: (progress: DesktopUpdaterProgress) => void): this
  /**
   * Subscribe to verified download completion.
   * @param event - Downloaded event name.
   * @param listener - Downloaded callback.
   * @returns The updater instance.
   */
  on(event: 'update-downloaded', listener: (info: DesktopUpdaterDownloadedInfo) => void): this
  /**
   * Subscribe to asynchronous installer handoff errors.
   * @param event - Error event name.
   * @param listener - Error callback.
   * @returns The updater instance.
   */
  on(event: 'error', listener: (error: Error) => void): this
  /**
   * Unsubscribe from download progress updates.
   * @param event - Progress event name.
   * @param listener - Progress callback.
   * @returns The updater instance.
   */
  off(event: 'download-progress', listener: (progress: DesktopUpdaterProgress) => void): this
  /**
   * Unsubscribe from verified download completion.
   * @param event - Downloaded event name.
   * @param listener - Downloaded callback.
   * @returns The updater instance.
   */
  off(event: 'update-downloaded', listener: (info: DesktopUpdaterDownloadedInfo) => void): this
  /**
   * Unsubscribe from asynchronous installer handoff errors.
   * @param event - Error event name.
   * @param listener - Error callback.
   * @returns The updater instance.
   */
  off(event: 'error', listener: (error: Error) => void): this
  /**
   * Emit an updater event.
   * @param event - Event name.
   * @param args - Event arguments.
   * @returns `true` if the event had listeners.
   */
  emit(event: string, ...args: unknown[]): boolean
}

/** Options for selecting between `electron-updater` (`app-update.yml`) and `GitHubReleaseUpdater` (`dshReleaseRepository`). */
export interface DesktopUpdateSourceOptions {
  /** Parsed application `package.json` manifest. */
  readonly manifest: unknown
  /** Whether the application is running from a packaged bundle (`app.isPackaged`). */
  readonly isPackaged?: boolean
  /** Electron `process.resourcesPath` directory containing `app-update.yml` when present. */
  readonly resourcesPath?: string
  /** Callback returning the currently installed application SemVer version. */
  readonly currentVersion?: () => string
  /** Target operating system platform; defaults to `process.platform`. */
  readonly platform?: NodeJS.Platform
  /** Target CPU architecture; defaults to `process.arch`. */
  readonly arch?: string
  /** HTTP inactivity timeout in milliseconds. */
  readonly timeoutMs?: number
  /** Injectable `fetch` implementation for GitHub Releases requests. */
  readonly fetch?: typeof globalThis.fetch
  /** Injectable `spawn` implementation for Windows `.exe` installer launch. */
  readonly spawn?: SpawnInstallerProcess
  /** Injectable macOS `.dmg` opener (`shell.openPath`). */
  readonly openInstaller?: (filePath: string) => Promise<string>
  /** Injectable application quit callback (`() => app.quit()`). */
  readonly quit?: () => void
  /** Base temporary directory for downloaded installers. */
  readonly tempRootDir?: string
}

/** Resolved updater implementation and packaged-source availability predicate. */
export interface ResolvedDesktopUpdateSource {
  /** Selected updater adapter (`autoUpdater` or `GitHubReleaseUpdater`). */
  readonly updater: DesktopAppUpdater
  /** Predicate reporting whether an update source is configured for this process. */
  readonly enabled: () => boolean
  /** Kind of update source selected (`'electron-updater'`, `'github-releases'`, or `'none'`). */
  readonly kind: 'electron-updater' | 'github-releases' | 'none'
}

/**
 * Check whether the packaged application bundle contains an `electron-updater` feed configuration (`resources/app-update.yml`).
 * @param resourcesPath - Electron `process.resourcesPath` directory.
 * @returns `true` when `app-update.yml` exists in `resourcesPath`.
 */
export function hasPackagedUpdateConfig(resourcesPath: string = process.resourcesPath): boolean {
  return existsSync(join(resourcesPath, 'app-update.yml'))
}

/**
 * Select the desktop update provider according to packaged `app-update.yml` presence and `dshReleaseRepository` metadata.
 * @param options - Manifest, packaging state, `resourcesPath`, and platform/network hooks.
 * @returns Active updater instance, `enabled()` predicate, and selected provider kind.
 */
export function resolveDesktopUpdateSource(options: DesktopUpdateSourceOptions): ResolvedDesktopUpdateSource {
  const isPackaged = options.isPackaged ?? app.isPackaged
  const resourcesPath = options.resourcesPath ?? process.resourcesPath
  const releaseRepository = desktopReleaseRepository(options.manifest)
  if (!isPackaged) {
    return {
      updater: autoUpdater,
      enabled: () => false,
      kind: 'none',
    }
  }
  if (hasPackagedUpdateConfig(resourcesPath)) {
    return {
      updater: autoUpdater,
      enabled: () => true,
      kind: 'electron-updater',
    }
  }
  if (releaseRepository !== undefined) {
    const updater = new GitHubReleaseUpdater({
      repository: releaseRepository,
      currentVersion: options.currentVersion ?? (() => app.getVersion()),
      ...(options.platform === undefined ? {} : { platform: options.platform }),
      ...(options.arch === undefined ? {} : { arch: options.arch }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.spawn === undefined ? {} : { spawn: options.spawn }),
      ...(options.openInstaller === undefined ? {} : { openInstaller: options.openInstaller }),
      ...(options.quit === undefined ? {} : { quit: options.quit }),
      ...(options.tempRootDir === undefined ? {} : { tempRootDir: options.tempRootDir }),
    })
    return {
      updater,
      enabled: () => true,
      kind: 'github-releases',
    }
  }
  return {
    updater: autoUpdater,
    enabled: () => false,
    kind: 'none',
  }
}

/** Owns one updater target until its download and installation settle. */
export class DesktopUpdateCoordinator {
  private current: DesktopUpdateState = { phase: 'idle' }
  private candidate: string | undefined
  private downloaded = false
  private disposed = false
  private checkOperation: Promise<DesktopUpdateState> | undefined
  private downloadOperation: Promise<DesktopUpdateState> | undefined
  private installOperation: Promise<DesktopUpdateState> | undefined

  private readonly onProgress = (progress: DesktopUpdaterProgress): void => {
    if (this.downloadOperation === undefined || this.downloaded) return
    const percent = Math.min(100, Math.max(0, progress.percent))
    this.setState({ phase: percent >= 100 ? 'verifying' : 'downloading', ...this.target(), percent })
  }

  private readonly onDownloaded = (info: DesktopUpdaterDownloadedInfo): void => {
    if (this.downloadOperation === undefined || info.version !== this.candidate) return
    this.downloaded = true
  }

  private readonly onError = (error: Error): void => {
    // Check/download promises own their failures. Installation can fail after quitAndInstall returns.
    if (this.current.phase === 'installing') {
      this.setState(this.failure(error, 'install'))
    }
  }

  /**
   * @param publish - Receives observable states for every Desktop window.
   * @param beforeRestart - Completes task authorization, admission locking, and owned-process shutdown.
   * @param updater - Process-owned Electron updater, replaceable at the network/platform test boundary.
   * @param enabled - Whether this process has a packaged update source.
   * @param currentVersion - Actual installed application version.
   * @param downloadResult - Once per completed download attempt, including platform preparation failures.
   * @param channel - Installed package channel; omitted test/local callers retain nightly.
   */
  constructor(
    private readonly publish: (state: DesktopUpdateState) => DesktopUpdateState,
    private readonly beforeRestart: () => Promise<boolean>,
    private readonly updater: DesktopAppUpdater = autoUpdater,
    private readonly enabled: () => boolean = () => app.isPackaged && hasPackagedUpdateConfig(process.resourcesPath),
    private readonly currentVersion: () => string = () => app.getVersion(),
    private readonly downloadResult?: (success: boolean, reason?: string) => void,
    private readonly channel: 'nightly' | 'latest' = 'nightly',
  ) {
    if (updater === autoUpdater) {
      // electron-updater omits this internal transport property from its public declarations.
      // Real-Electron qualification exercises the pinned dependency integration.
      const transportOwner = updater as AppUpdater & { httpExecutor: DesktopUpdateHttpExecutor }
      transportOwner.httpExecutor = new DesktopUpdateHttpExecutor(
        Number(process.env.DSH_DESKTOP_UPDATE_HTTP_IDLE_TIMEOUT_MS ?? 60_000),
        (authInfo, callback) => { updater.emit('login', authInfo, callback) },
      )
    }
    this.updater.autoDownload = false
    this.updater.autoInstallOnAppQuit = false
    this.updater.channel = channel
    this.updater.allowPrerelease = channel === 'nightly'
    // Selecting a channel can enable downgrade in electron-updater.
    this.updater.allowDowngrade = false
    this.updater.on('download-progress', this.onProgress)
    this.updater.on('update-downloaded', this.onDownloaded)
    this.updater.on('error', this.onError)
  }

  /** Latest observable state; complete download identity remains main-process-owned. */
  get state(): DesktopUpdateState { return this.current }

  /**
   * Check metadata without downloading, joining any current check.
   * @param manual - Whether a failed check must remain visible in the status indicator.
   * @returns The check result, including a silent automatic failure when applicable.
   */
  async check(manual = false): Promise<DesktopUpdateState> {
    this.assertLive()
    if (this.downloadOperation !== undefined || this.installOperation !== undefined || this.downloaded) return this.current
    if (!manual && this.current.phase === 'error' && this.current.failedOperation === 'download') return this.current
    this.checkOperation ??= Promise.resolve().then(() => this.doCheck())
      .finally(() => { this.checkOperation = undefined })
    const result = await this.checkOperation
    if (manual && result.phase === 'error') this.setState(result)
    return result
  }

  /**
   * @param version - Version shown in the user's download confirmation.
   * @returns Download readiness or failure, without authorizing installation.
   */
  async download(version: string): Promise<DesktopUpdateState> {
    this.assertLive()
    if (this.downloaded || this.installOperation !== undefined) return this.current
    this.downloadOperation ??= Promise.resolve().then(async () => {
      await this.checkOperation
      this.assertLive()
      if (this.candidate === undefined) throw new Error('desktop update: no checked update is available')
      if (version !== this.candidate) throw new Error('desktop update: download confirmation is stale')
      this.setState({ phase: 'downloading', version, percent: 0 })
      try {
        await this.updater.downloadUpdate()
        if (!this.downloaded) throw new Error('desktop update: platform preparation did not report readiness')
        this.downloadResult?.(true)
        return this.setState({ phase: 'ready', version })
      } catch (error) {
        this.downloaded = false
        this.downloadResult?.(false, error instanceof DesktopUpdatePreparationError ? error.kind : 'download_failed')
        return this.setState(this.failure(error, 'download'))
      }
    }).finally(() => { this.downloadOperation = undefined })
    return this.downloadOperation
  }

  /**
   * Install a prepared target after a separate user confirmation.
   * @param version - Exact version displayed in the confirmation, never a renderer-selected URL.
   * @returns Installation handoff or a recoverable preparation error.
   */
  async install(version: string): Promise<DesktopUpdateState> {
    this.assertLive()
    if (!this.downloaded || this.downloadOperation !== undefined || version !== this.candidate) throw new Error('desktop update: confirmed target is not ready')
    this.installOperation ??= Promise.resolve().then(async () => {
      this.setState({ phase: 'installing', version })
      try {
        if (!await this.beforeRestart()) return this.setState({ phase: 'ready', version })
        this.assertLive()
        this.updater.quitAndInstall(true, true)
        return this.current
      } catch (error) {
        if (this.current.phase === 'error' && this.current.failedOperation === 'install') return this.current
        return this.setState(this.failure(error, 'install'))
      }
    }).finally(() => { this.installOperation = undefined })
    return this.installOperation
  }

  /** Remove owned listeners and prevent pending library operations from publishing into closed UI. */
  dispose(): void {
    this.disposed = true
    this.updater.off('download-progress', this.onProgress)
    this.updater.off('update-downloaded', this.onDownloaded)
    // Pending updater promises can still emit EventEmitter errors during shutdown.
    void Promise.allSettled([this.checkOperation, this.downloadOperation, this.installOperation])
      .then(() => { this.updater.off('error', this.onError) })
  }

  private assertLive(): void {
    if (this.disposed) throw new Error('desktop update: coordinator is disposed')
  }

  private setState(state: DesktopUpdateState): DesktopUpdateState {
    if (!this.disposed) {
      this.current = state
      this.publish(state)
    }
    return state
  }

  private failure(error: unknown, failedOperation: 'check' | 'download' | 'install'): DesktopUpdateState {
    return { phase: 'error', ...this.target(), failedOperation,
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof DesktopUpdatePreparationError ? {
        preparationFailure: error.kind,
        ...(error.technicalDetails === undefined ? {} : { technicalDetails: error.technicalDetails }),
      } : {}) }
  }

  private target(): { version?: string } {
    return this.candidate === undefined ? {} : { version: this.candidate }
  }

  private async doCheck(): Promise<DesktopUpdateState> {
    try {
      this.assertLive()
      if (!this.enabled()) throw new Error('desktop update: this application has no packaged update source')
      const result = await this.updater.checkForUpdates()
      if (result === null) throw new Error('desktop update: no check result was returned')
      const version = result.updateInfo.version
      if (valid(version) === null) throw new Error('desktop update: feed version is invalid')
      if (this.channel === 'latest' && version.includes('-')) throw new Error('desktop update: latest feed contains a prerelease')
      this.candidate = result.isUpdateAvailable && gt(version, this.currentVersion()) ? version : undefined
      return this.setState(this.candidate === undefined ? { phase: 'idle' } : { phase: 'available', version })
    } catch (error) {
      return this.failure(error, 'check')
    }
  }
}
