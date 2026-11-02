import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SpawnInstallerProcess } from '../src/github-release-updater.ts'
import type { DesktopUpdateState } from '../src/ipc.ts'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getVersion: () => '1.0.1',
  },
}))
vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: Object.assign(new EventEmitter(), {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      channel: 'nightly',
      allowPrerelease: false,
      allowDowngrade: false,
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      quitAndInstall: vi.fn(),
    }),
  },
}))

const {
  GitHubReleaseUpdater,
  parseSha256Sums,
  resolveGitHubReleasePlatformTarget,
  selectGitHubReleaseAssets,
} = await import('../src/github-release-updater.ts')
const {
  DesktopUpdateCoordinator,
  hasPackagedUpdateConfig,
  resolveDesktopUpdateSource,
} = await import('../src/update-coordinator.ts')

const REPOSITORY_URL = 'https://github.com/cannoneer85-svg/strataharness-app.git'
const RELEASES_API_URL = 'https://api.github.com/repos/cannoneer85-svg/strataharness-app/releases?per_page=20'

const tempDirectories: string[] = []
const coordinators: InstanceType<typeof DesktopUpdateCoordinator>[] = []

afterEach(() => {
  for (const coordinator of coordinators.splice(0)) {
    coordinator.dispose()
  }
  for (const dir of tempDirectories.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirectories.push(dir)
  return dir
}

function sha256Hex(content: Uint8Array | string): string {
  return createHash('sha256').update(content).digest('hex')
}

function createChunkedStream(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index]
      index += 1
      if (chunk === undefined) {
        controller.close()
        return
      }
      controller.enqueue(chunk)
    },
  })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

function binaryResponse(chunks: readonly Uint8Array[], totalLength?: number, status = 200): Response {
  const byteLength = totalLength ?? chunks.reduce((sum, item) => sum + item.byteLength, 0)
  return new Response(createChunkedStream(chunks), {
    status,
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(byteLength),
    },
  })
}

describe('GitHubReleaseUpdater and DesktopUpdateCoordinator integration (AC 4–AC 10)', () => {
  it('AC 4: switches to GitHubReleaseUpdater when app-update.yml is absent and dshReleaseRepository is configured', async () => {
    const emptyResourcesDir = makeTempDir('strata-no-app-update-')
    const tempRootDir = makeTempDir('strata-download-tmp-')
    expect(hasPackagedUpdateConfig(emptyResourcesDir)).toBe(false)

    const fetchMock = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      expect(url).toBe(RELEASES_API_URL)
      expect(init?.headers).toEqual({
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'StrataHarness/1.0.1',
      })
      return jsonResponse([], 200)
    })

    const source = resolveDesktopUpdateSource({
      manifest: {
        name: '@strata/desktop',
        version: '1.0.1',
        dshReleaseRepository: REPOSITORY_URL,
      },
      isPackaged: true,
      resourcesPath: emptyResourcesDir,
      currentVersion: () => '1.0.1',
      fetch: fetchMock,
      tempRootDir,
    })

    expect(source.kind).toBe('github-releases')
    expect(source.enabled()).toBe(true)
    expect(source.updater).toBeInstanceOf(GitHubReleaseUpdater)

    const states: DesktopUpdateState[] = []
    const coordinator = new DesktopUpdateCoordinator(
      (state) => { states.push(state); return state },
      async () => true,
      source.updater,
      source.enabled,
      () => '1.0.1',
    )
    coordinators.push(coordinator)

    const state = await coordinator.check(true)
    expect(state).toEqual({ phase: 'idle' })
    expect(fetchMock).toHaveBeenCalledOnce()

    // When resources/app-update.yml exists, electron-updater remains selected.
    const feedResourcesDir = makeTempDir('strata-with-app-update-')
    writeFileSync(join(feedResourcesDir, 'app-update.yml'), 'provider: generic\nurl: https://updates.example.com\n')
    expect(hasPackagedUpdateConfig(feedResourcesDir)).toBe(true)
    const electronSource = resolveDesktopUpdateSource({
      manifest: {
        name: '@strata/desktop',
        version: '1.0.1',
        dshReleaseRepository: REPOSITORY_URL,
      },
      isPackaged: true,
      resourcesPath: feedResourcesDir,
    })
    expect(electronSource.kind).toBe('electron-updater')
    expect(electronSource.enabled()).toBe(true)

    // When neither app-update.yml nor dshReleaseRepository is present, updates remain disabled.
    const disabledSource = resolveDesktopUpdateSource({
      manifest: { name: '@strata/desktop', version: '1.0.1' },
      isPackaged: true,
      resourcesPath: emptyResourcesDir,
    })
    expect(disabledSource.kind).toBe('none')
    expect(disabledSource.enabled()).toBe(false)
    const disabledCoordinator = new DesktopUpdateCoordinator(
      stateValue => stateValue,
      async () => true,
      disabledSource.updater,
      disabledSource.enabled,
      () => '1.0.1',
    )
    coordinators.push(disabledCoordinator)
    expect(await disabledCoordinator.check(true)).toMatchObject({
      phase: 'error',
      failedOperation: 'check',
      message: 'desktop update: this application has no packaged update source',
    })
  })

  it('AC 5: returns phase idle on HTTP 404, draft-only releases, non-strata tags, or versions <= currentVersion', async () => {
    const scenarios: Array<{ readonly name: string; readonly status: number; readonly body: unknown }> = [
      { name: 'HTTP 404 not found', status: 404, body: { message: 'Not Found' } },
      { name: 'empty release list', status: 200, body: [] },
      {
        name: 'draft and non-strata releases only',
        status: 200,
        body: [
          { tag_name: 'strata-v1.0.5', draft: true, prerelease: false, assets: [] },
          { tag_name: 'dsh-v0.2.1-rc.5', draft: false, prerelease: false, assets: [] },
          { tag_name: 'v2.0.0', draft: false, prerelease: false, assets: [] },
          { tag_name: 'strata-vnot-semver', draft: false, prerelease: false, assets: [] },
        ],
      },
      {
        name: 'latest strata-v* equal to or older than installed 1.0.1',
        status: 200,
        body: [
          { tag_name: 'strata-v1.0.0', draft: false, prerelease: false, assets: [] },
          { tag_name: 'strata-v1.0.1', draft: false, prerelease: false, assets: [] },
        ],
      },
    ]

    for (const scenario of scenarios) {
      const updater = new GitHubReleaseUpdater({
        repository: REPOSITORY_URL,
        currentVersion: () => '1.0.1',
        fetch: vi.fn<typeof globalThis.fetch>(async () => jsonResponse(scenario.body, scenario.status)),
      })
      const coordinator = new DesktopUpdateCoordinator(
        state => state,
        async () => true,
        updater,
        () => true,
        () => '1.0.1',
      )
      coordinators.push(coordinator)
      expect(await coordinator.check(true), scenario.name).toEqual({ phase: 'idle' })
    }

    // Non-404 HTTP error fails check visibly.
    const failingUpdater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1',
      fetch: vi.fn<typeof globalThis.fetch>(async () => jsonResponse({ message: 'rate limit' }, 503)),
    })
    const failingCoordinator = new DesktopUpdateCoordinator(
      state => state,
      async () => true,
      failingUpdater,
      () => true,
      () => '1.0.1',
    )
    coordinators.push(failingCoordinator)
    expect(await failingCoordinator.check(true)).toMatchObject({
      phase: 'error',
      failedOperation: 'check',
      message: expect.stringMatching(/HTTP 503/u),
    })
  })

  it('AC 6: ignores prereleases on a stable installed version (1.0.1) and includes them on a prerelease installed version (1.0.1-rc.1)', async () => {
    const releasesPayload = [
      { tag_name: 'strata-v1.0.3-rc.1', draft: false, prerelease: true, assets: [] },
      { tag_name: 'strata-v1.0.2-rc.2', draft: false, prerelease: false, assets: [] },
      { tag_name: 'strata-v1.0.1', draft: false, prerelease: false, assets: [] },
    ]

    // Stable installed version 1.0.1 ignores both prerelease: true and -rc.2 tags -> idle.
    const stableUpdater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1',
      fetch: vi.fn<typeof globalThis.fetch>(async () => jsonResponse(releasesPayload)),
    })
    const stableCoordinator = new DesktopUpdateCoordinator(
      state => state,
      async () => true,
      stableUpdater,
      () => true,
      () => '1.0.1',
    )
    coordinators.push(stableCoordinator)
    expect(await stableCoordinator.check(true)).toEqual({ phase: 'idle' })

    // Stable installed version 1.0.1 picks stable 1.0.2 while ignoring 1.0.3-rc.1.
    const mixedUpdater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1',
      fetch: vi.fn<typeof globalThis.fetch>(async () =>
        jsonResponse([
          ...releasesPayload,
          { tag_name: 'strata-v1.0.2', draft: false, prerelease: false, assets: [] },
        ])),
    })
    const mixedCoordinator = new DesktopUpdateCoordinator(
      state => state,
      async () => true,
      mixedUpdater,
      () => true,
      () => '1.0.1',
    )
    coordinators.push(mixedCoordinator)
    expect(await mixedCoordinator.check(true)).toEqual({ phase: 'available', version: '1.0.2' })

    // Prerelease installed version 1.0.1-rc.1 considers prereleases and selects highest 1.0.3-rc.1.
    const prereleaseUpdater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1-rc.1',
      fetch: vi.fn<typeof globalThis.fetch>(async () => jsonResponse(releasesPayload)),
    })
    const prereleaseCoordinator = new DesktopUpdateCoordinator(
      state => state,
      async () => true,
      prereleaseUpdater,
      () => true,
      () => '1.0.1-rc.1',
    )
    coordinators.push(prereleaseCoordinator)
    expect(await prereleaseCoordinator.check(true)).toEqual({ phase: 'available', version: '1.0.3-rc.1' })
  })

  it('AC 7: transitions to phase available for newer strata-v<version> and prioritizes signed installer assets over -unsigned', () => {
    expect(resolveGitHubReleasePlatformTarget('win32', 'x64')).toEqual({ target: 'win-x64', extension: 'exe' })
    expect(resolveGitHubReleasePlatformTarget('darwin', 'arm64')).toEqual({ target: 'mac-arm64', extension: 'dmg' })
    expect(resolveGitHubReleasePlatformTarget('darwin', 'x64')).toEqual({ target: 'mac-x64', extension: 'dmg' })
    expect(() => resolveGitHubReleasePlatformTarget('linux', 'x64')).toThrow(/unsupported platform target/u)

    const checksumsAsset = {
      name: 'SHA256SUMS.txt',
      browserDownloadUrl: 'https://github.com/cannoneer85-svg/strataharness-app/releases/download/strata-v1.0.2/SHA256SUMS.txt',
    }
    const unsignedWinAsset = {
      name: 'strataharness-1.0.2-win-x64-unsigned.exe',
      browserDownloadUrl: 'https://github.com/cannoneer85-svg/strataharness-app/releases/download/strata-v1.0.2/strataharness-1.0.2-win-x64-unsigned.exe',
    }
    const signedWinAsset = {
      name: 'strataharness-1.0.2-win-x64.exe',
      browserDownloadUrl: 'https://github.com/cannoneer85-svg/strataharness-app/releases/download/strata-v1.0.2/strataharness-1.0.2-win-x64.exe',
    }

    // When both signed and unsigned exist, signed wins regardless of array order.
    const bothSelected = selectGitHubReleaseAssets(
      '1.0.2',
      [unsignedWinAsset, signedWinAsset, checksumsAsset],
      'win32',
      'x64',
    )
    expect(bothSelected.signed).toBe(true)
    expect(bothSelected.installerAsset.name).toBe('strataharness-1.0.2-win-x64.exe')

    // When only -unsigned exists, falls back to -unsigned.
    const unsignedSelected = selectGitHubReleaseAssets(
      '1.0.2',
      [unsignedWinAsset, checksumsAsset],
      'win32',
      'x64',
    )
    expect(unsignedSelected.signed).toBe(false)
    expect(unsignedSelected.installerAsset.name).toBe('strataharness-1.0.2-win-x64-unsigned.exe')

    // macOS arm64 and x64 select .dmg artifacts.
    const macArmSelected = selectGitHubReleaseAssets(
      '1.0.2',
      [
        {
          name: 'strataharness-1.0.2-mac-arm64-unsigned.dmg',
          browserDownloadUrl: 'https://github.com/cannoneer85-svg/strataharness-app/releases/download/strata-v1.0.2/strataharness-1.0.2-mac-arm64-unsigned.dmg',
        },
        checksumsAsset,
      ],
      'darwin',
      'arm64',
    )
    expect(macArmSelected.target).toBe('mac-arm64')
    expect(macArmSelected.installerAsset.name).toBe('strataharness-1.0.2-mac-arm64-unsigned.dmg')
  })

  it('AC 8: streams installer with 0%..100% progress (downloading -> verifying), verifies SHA256SUMS.txt, and transitions to ready', async () => {
    const tempRootDir = makeTempDir('strata-ac8-tmp-')
    const chunk1 = Buffer.from('strata-installer-part-1-')
    const chunk2 = Buffer.from('strata-installer-part-2-final')
    const fullBinary = Buffer.concat([chunk1, chunk2])
    const expectedHash = sha256Hex(fullBinary).toUpperCase()

    const installerUrl = 'https://github.com/cannoneer85-svg/strataharness-app/releases/download/strata-v1.0.2/strataharness-1.0.2-win-x64-unsigned.exe'
    const checksumsUrl = 'https://github.com/cannoneer85-svg/strataharness-app/releases/download/strata-v1.0.2/SHA256SUMS.txt'

    const fetchMock = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url === RELEASES_API_URL) {
        return jsonResponse([
          {
            tag_name: 'strata-v1.0.2',
            draft: false,
            prerelease: false,
            assets: [
              {
                name: 'strataharness-1.0.2-win-x64-unsigned.exe',
                browser_download_url: installerUrl,
                size: fullBinary.byteLength,
              },
              {
                name: 'SHA256SUMS.txt',
                browser_download_url: checksumsUrl,
              },
            ],
          },
        ])
      }
      if (url === installerUrl) {
        return binaryResponse([chunk1, chunk2], fullBinary.byteLength)
      }
      if (url === checksumsUrl) {
        return textResponse(
          [
            `${sha256Hex('other')}  strataharness-1.0.2-mac-arm64-unsigned.dmg`,
            `${expectedHash} *strataharness-1.0.2-win-x64-unsigned.exe`,
          ].join('\n'),
        )
      }
      throw new Error(`unexpected URL ${url}`)
    })

    const updater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1',
      platform: 'win32',
      arch: 'x64',
      fetch: fetchMock,
      tempRootDir,
    })

    const states: DesktopUpdateState[] = []
    const coordinator = new DesktopUpdateCoordinator(
      (state) => { states.push(state); return state },
      async () => true,
      updater,
      () => true,
      () => '1.0.1',
    )
    coordinators.push(coordinator)

    expect(await coordinator.check(true)).toEqual({ phase: 'available', version: '1.0.2' })
    expect(await coordinator.download('1.0.2')).toEqual({ phase: 'ready', version: '1.0.2' })

    // Verify intermediate phases: available -> downloading (0%..99%) -> verifying (100%) -> ready
    expect(states[0]).toEqual({ phase: 'available', version: '1.0.2' })
    expect(states.some(s => s.phase === 'downloading' && s.percent === 0)).toBe(true)
    expect(states.some(s => s.phase === 'downloading' && (s.percent ?? 0) > 0 && (s.percent ?? 0) < 100)).toBe(true)
    expect(states.some(s => s.phase === 'verifying' && s.percent === 100)).toBe(true)
    expect(states.at(-1)).toEqual({ phase: 'ready', version: '1.0.2' })

    expect(updater.preparedInstallerPath).toBeDefined()
    expect(existsSync(updater.preparedInstallerPath!)).toBe(true)
    expect(readFileSync(updater.preparedInstallerPath!)).toEqual(fullBinary)
  })

  it('AC 9: deletes temporary files immediately and returns phase error (failedOperation: download) when asset or SHA256SUMS.txt is missing or SHA-256 mismatches', async () => {
    const binaryData = Buffer.from('corrupted-or-unverified-binary-payload')
    const validHash = sha256Hex(binaryData)
    const wrongHash = '0'.repeat(64)

    const installerUrl = 'https://github.com/cannoneer85-svg/strataharness-app/releases/download/strata-v1.0.2/strataharness-1.0.2-win-x64-unsigned.exe'
    const checksumsUrl = 'https://github.com/cannoneer85-svg/strataharness-app/releases/download/strata-v1.0.2/SHA256SUMS.txt'

    const failureCases: Array<{
      readonly name: string
      readonly assets: ReadonlyArray<{ readonly name: string; readonly browser_download_url: string }>
      readonly checksumsContent: string
    }> = [
      {
        name: 'missing platform installer asset in release',
        assets: [
          {
            name: 'strataharness-1.0.2-mac-arm64-unsigned.dmg',
            browser_download_url: 'https://github.com/cannoneer85-svg/strataharness-app/releases/download/strata-v1.0.2/strataharness-1.0.2-mac-arm64-unsigned.dmg',
          },
          { name: 'SHA256SUMS.txt', browser_download_url: checksumsUrl },
        ],
        checksumsContent: `${validHash}  strataharness-1.0.2-win-x64-unsigned.exe\n`,
      },
      {
        name: 'missing SHA256SUMS.txt asset in release',
        assets: [
          { name: 'strataharness-1.0.2-win-x64-unsigned.exe', browser_download_url: installerUrl },
        ],
        checksumsContent: '',
      },
      {
        name: 'missing installer filename inside SHA256SUMS.txt',
        assets: [
          { name: 'strataharness-1.0.2-win-x64-unsigned.exe', browser_download_url: installerUrl },
          { name: 'SHA256SUMS.txt', browser_download_url: checksumsUrl },
        ],
        checksumsContent: `${validHash}  strataharness-1.0.2-mac-arm64-unsigned.dmg\n`,
      },
      {
        name: 'SHA-256 digest mismatch against SHA256SUMS.txt',
        assets: [
          { name: 'strataharness-1.0.2-win-x64-unsigned.exe', browser_download_url: installerUrl },
          { name: 'SHA256SUMS.txt', browser_download_url: checksumsUrl },
        ],
        checksumsContent: `${wrongHash}  strataharness-1.0.2-win-x64-unsigned.exe\n`,
      },
    ]

    for (const testCase of failureCases) {
      const tempRootDir = makeTempDir('strata-ac9-tmp-')
      const updater = new GitHubReleaseUpdater({
        repository: REPOSITORY_URL,
        currentVersion: () => '1.0.1',
        platform: 'win32',
        arch: 'x64',
        tempRootDir,
        fetch: vi.fn<typeof globalThis.fetch>(async (input) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
          if (url === RELEASES_API_URL) {
            return jsonResponse([
              {
                tag_name: 'strata-v1.0.2',
                draft: false,
                prerelease: false,
                assets: testCase.assets,
              },
            ])
          }
          if (url === installerUrl) {
            return binaryResponse([binaryData], binaryData.byteLength)
          }
          if (url === checksumsUrl) {
            return textResponse(testCase.checksumsContent)
          }
          throw new Error(`unexpected URL ${url}`)
        }),
      })

      const coordinator = new DesktopUpdateCoordinator(
        state => state,
        async () => true,
        updater,
        () => true,
        () => '1.0.1',
      )
      coordinators.push(coordinator)

      expect(await coordinator.check(true), testCase.name).toEqual({ phase: 'available', version: '1.0.2' })
      const downloadState = await coordinator.download('1.0.2')
      expect(downloadState, testCase.name).toMatchObject({
        phase: 'error',
        version: '1.0.2',
        failedOperation: 'download',
      })
      expect(updater.preparedInstallerPath, testCase.name).toBeUndefined()
      expect(readdirSync(tempRootDir), `${testCase.name}: temp directory cleaned up`).toEqual([])
    }
  })

  it('AC 10 (win32): spawns verified .exe with detached: true, stdio: ignore, windowsHide: false, calls unref() and quit() on spawn, or emits install error on spawn failure', async () => {
    const tempRootDir = makeTempDir('strata-ac10-win-')
    const binaryData = Buffer.from('windows-nsis-installer-binary')
    const validHash = sha256Hex(binaryData)
    const installerUrl = 'https://github.com/cannoneer85-svg/strataharness-app/releases/download/strata-v1.0.2/strataharness-1.0.2-win-x64.exe'
    const checksumsUrl = 'https://github.com/cannoneer85-svg/strataharness-app/releases/download/strata-v1.0.2/SHA256SUMS.txt'

    const unrefMock = vi.fn()
    let spawnedChild: EventEmitter | undefined
    const spawnMock = vi.fn<SpawnInstallerProcess>(() => {
      const child = Object.assign(new EventEmitter(), { unref: unrefMock })
      spawnedChild = child
      queueMicrotask(() => {
        child.emit('spawn')
      })
      return child
    })
    const quitMock = vi.fn()
    const beforeRestart = vi.fn(async () => true)

    const updater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1',
      platform: 'win32',
      arch: 'x64',
      tempRootDir,
      spawn: spawnMock,
      quit: quitMock,
      fetch: vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url === RELEASES_API_URL) {
          return jsonResponse([
            {
              tag_name: 'strata-v1.0.2',
              draft: false,
              prerelease: false,
              assets: [
                { name: 'strataharness-1.0.2-win-x64.exe', browser_download_url: installerUrl },
                { name: 'SHA256SUMS.txt', browser_download_url: checksumsUrl },
              ],
            },
          ])
        }
        if (url === installerUrl) return binaryResponse([binaryData], binaryData.byteLength)
        if (url === checksumsUrl) return textResponse(`${validHash}  strataharness-1.0.2-win-x64.exe\n`)
        throw new Error(`unexpected URL ${url}`)
      }),
    })

    const coordinator = new DesktopUpdateCoordinator(
      state => state,
      beforeRestart,
      updater,
      () => true,
      () => '1.0.1',
    )
    coordinators.push(coordinator)

    await coordinator.check(true)
    await coordinator.download('1.0.2')
    const verifiedPath = updater.preparedInstallerPath!
    expect(verifiedPath).toContain('strataharness-1.0.2-win-x64.exe')

    const installState = await coordinator.install('1.0.2')
    expect(installState).toEqual({ phase: 'installing', version: '1.0.2' })
    expect(beforeRestart).toHaveBeenCalledOnce()
    expect(spawnMock).toHaveBeenCalledExactlyOnceWith(verifiedPath, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })
    await Promise.resolve()
    expect(spawnedChild).toBeDefined()
    expect(unrefMock).toHaveBeenCalledOnce()
    expect(quitMock).toHaveBeenCalledOnce()

    // Asynchronous spawn error transitions coordinator to phase: 'error', failedOperation: 'install' without quitting.
    const failingUnref = vi.fn()
    const failingQuit = vi.fn()
    const failingSpawn = vi.fn<SpawnInstallerProcess>(() => {
      const child = Object.assign(new EventEmitter(), { unref: failingUnref })
      queueMicrotask(() => {
        child.emit('error', Object.assign(new Error('spawn EACCES'), { code: 'EACCES' }))
      })
      return child
    })
    const failingUpdater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1',
      platform: 'win32',
      arch: 'x64',
      tempRootDir,
      spawn: failingSpawn,
      quit: failingQuit,
      fetch: vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url === RELEASES_API_URL) {
          return jsonResponse([
            {
              tag_name: 'strata-v1.0.2',
              draft: false,
              prerelease: false,
              assets: [
                { name: 'strataharness-1.0.2-win-x64.exe', browser_download_url: installerUrl },
                { name: 'SHA256SUMS.txt', browser_download_url: checksumsUrl },
              ],
            },
          ])
        }
        if (url === installerUrl) return binaryResponse([binaryData], binaryData.byteLength)
        if (url === checksumsUrl) return textResponse(`${validHash}  strataharness-1.0.2-win-x64.exe\n`)
        throw new Error(`unexpected URL ${url}`)
      }),
    })
    const failingCoordinator = new DesktopUpdateCoordinator(
      state => state,
      async () => true,
      failingUpdater,
      () => true,
      () => '1.0.1',
    )
    coordinators.push(failingCoordinator)
    await failingCoordinator.check(true)
    await failingCoordinator.download('1.0.2')
    await failingCoordinator.install('1.0.2')
    await Promise.resolve()
    expect(failingUnref).not.toHaveBeenCalled()
    expect(failingQuit).not.toHaveBeenCalled()
    expect(failingCoordinator.state).toMatchObject({
      phase: 'error',
      version: '1.0.2',
      failedOperation: 'install',
      message: expect.stringContaining('spawn EACCES'),
    })
  })

  it('AC 10 (darwin): opens verified .dmg via openInstaller (shell.openPath) and calls quit() on empty error string, or emits install error on failure', async () => {
    const tempRootDir = makeTempDir('strata-ac10-mac-')
    const dmgData = Buffer.from('macos-disk-image-payload')
    const validHash = sha256Hex(dmgData)
    const dmgUrl = 'https://github.com/cannoneer85-svg/strataharness-app/releases/download/strata-v1.0.2/strataharness-1.0.2-mac-arm64-unsigned.dmg'
    const checksumsUrl = 'https://github.com/cannoneer85-svg/strataharness-app/releases/download/strata-v1.0.2/SHA256SUMS.txt'

    const openInstallerMock = vi.fn<(filePath: string) => Promise<string>>(async () => '')
    const quitMock = vi.fn()

    const updater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1',
      platform: 'darwin',
      arch: 'arm64',
      tempRootDir,
      openInstaller: openInstallerMock,
      quit: quitMock,
      fetch: vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url === RELEASES_API_URL) {
          return jsonResponse([
            {
              tag_name: 'strata-v1.0.2',
              draft: false,
              prerelease: false,
              assets: [
                { name: 'strataharness-1.0.2-mac-arm64-unsigned.dmg', browser_download_url: dmgUrl },
                { name: 'SHA256SUMS.txt', browser_download_url: checksumsUrl },
              ],
            },
          ])
        }
        if (url === dmgUrl) return binaryResponse([dmgData], dmgData.byteLength)
        if (url === checksumsUrl) return textResponse(`${validHash}  strataharness-1.0.2-mac-arm64-unsigned.dmg\n`)
        throw new Error(`unexpected URL ${url}`)
      }),
    })

    const coordinator = new DesktopUpdateCoordinator(
      state => state,
      async () => true,
      updater,
      () => true,
      () => '1.0.1',
    )
    coordinators.push(coordinator)

    await coordinator.check(true)
    await coordinator.download('1.0.2')
    const verifiedDmgPath = updater.preparedInstallerPath!
    expect(verifiedDmgPath).toContain('strataharness-1.0.2-mac-arm64-unsigned.dmg')

    await coordinator.install('1.0.2')
    await Promise.resolve()
    await Promise.resolve()
    expect(openInstallerMock).toHaveBeenCalledExactlyOnceWith(verifiedDmgPath)
    expect(quitMock).toHaveBeenCalledOnce()

    // Non-empty openPath error transitions coordinator to phase: 'error', failedOperation: 'install' without quitting.
    const failingOpenQuit = vi.fn()
    const failingUpdater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1',
      platform: 'darwin',
      arch: 'arm64',
      tempRootDir,
      openInstaller: async () => 'Failed to mount disk image',
      quit: failingOpenQuit,
      fetch: vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url === RELEASES_API_URL) {
          return jsonResponse([
            {
              tag_name: 'strata-v1.0.2',
              draft: false,
              prerelease: false,
              assets: [
                { name: 'strataharness-1.0.2-mac-arm64-unsigned.dmg', browser_download_url: dmgUrl },
                { name: 'SHA256SUMS.txt', browser_download_url: checksumsUrl },
              ],
            },
          ])
        }
        if (url === dmgUrl) return binaryResponse([dmgData], dmgData.byteLength)
        if (url === checksumsUrl) return textResponse(`${validHash}  strataharness-1.0.2-mac-arm64-unsigned.dmg\n`)
        throw new Error(`unexpected URL ${url}`)
      }),
    })
    const failingCoordinator = new DesktopUpdateCoordinator(
      state => state,
      async () => true,
      failingUpdater,
      () => true,
      () => '1.0.1',
    )
    coordinators.push(failingCoordinator)
    await failingCoordinator.check(true)
    await failingCoordinator.download('1.0.2')
    await failingCoordinator.install('1.0.2')
    await Promise.resolve()
    await Promise.resolve()
    expect(failingOpenQuit).not.toHaveBeenCalled()
    expect(failingCoordinator.state).toMatchObject({
      phase: 'error',
      version: '1.0.2',
      failedOperation: 'install',
      message: expect.stringContaining('Failed to mount disk image'),
    })
  })

  it('parses SHA256SUMS.txt lines in both standard and binary (*) formats and blocks disallowed redirect hops before requesting them', async () => {
    const digestA = 'a'.repeat(64)
    const digestB = 'B'.repeat(64)
    const parsed = parseSha256Sums(
      [
        '# comment line',
        `${digestA}  strataharness-1.0.2-win-x64.exe`,
        `${digestB} *./strataharness-1.0.2-mac-arm64.dmg`,
        '',
      ].join('\r\n'),
    )
    expect(parsed.get('strataharness-1.0.2-win-x64.exe')).toBe(digestA)
    expect(parsed.get('strataharness-1.0.2-mac-arm64.dmg')).toBe(digestB.toLowerCase())

    const requestedUrls: string[] = []
    const redirectUpdater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1',
      fetch: vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        requestedUrls.push(url)
        return new Response(null, {
          status: 302,
          headers: { location: 'http://insecure.example.com/releases.json' },
        })
      }),
    })
    await expect(redirectUpdater.checkForUpdates()).rejects.toThrow(/must use HTTPS/u)
    expect(requestedUrls).toEqual([RELEASES_API_URL])
  })
})
