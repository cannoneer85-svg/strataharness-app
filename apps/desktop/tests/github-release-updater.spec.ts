import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
const REPOSITORY_WEB_BASE = 'https://github.com/cannoneer85-svg/strataharness-app'
const LATEST_RELEASE_URL = `${REPOSITORY_WEB_BASE}/releases/latest`
const RELEASES_ATOM_URL = `${REPOSITORY_WEB_BASE}/releases.atom`

const tempDirectories: string[] = []
const coordinators: InstanceType<typeof DesktopUpdateCoordinator>[] = []

afterEach(() => {
  vi.useRealTimers()
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

function releaseTagUrl(tagName: string, baseUrl = REPOSITORY_WEB_BASE): string {
  return `${baseUrl}/releases/tag/${tagName}`
}

function releaseDownloadUrl(tagName: string, fileName: string, baseUrl = REPOSITORY_WEB_BASE): string {
  return `${baseUrl}/releases/download/${tagName}/${fileName}`
}

function atomFeed(
  entries: ReadonlyArray<{
    readonly href?: string
    readonly rel?: string | null
    readonly quote?: '"' | '\''
    readonly contentHtml?: string
    readonly summaryHtml?: string
    readonly prefixXml?: string
    readonly linkXml?: string
  }>,
): string {
  const renderedEntries = entries
    .map((entry) => {
      const q = entry.quote ?? '"'
      const relAttr = entry.rel === null ? '' : `rel=${q}${entry.rel ?? 'alternate'}${q} `
      const link = entry.linkXml ?? (entry.href === undefined ? '' : `<link ${relAttr}type=${q}text/html${q} href=${q}${entry.href}${q}/>`)
      const content = entry.contentHtml === undefined ? '' : `<content type="html">${entry.contentHtml}</content>`
      const summary = entry.summaryHtml === undefined ? '' : `<summary type="html">${entry.summaryHtml}</summary>`
      return `<entry>${entry.prefixXml ?? ''}${link}<title>Release</title>${summary}${content}</entry>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n${renderedEntries}\n</feed>`
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

function redirectResponse(location: string, status = 302, body: BodyInit | null = null): Response {
  return new Response(body, {
    status,
    headers: { location },
  })
}

function atomResponse(xml: string, status = 200): Response {
  return new Response(xml, {
    status,
    headers: { 'content-type': 'application/atom+xml; charset=utf-8' },
  })
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

function unstreamedTextResponse(body: string, url: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: new Headers({ 'content-type': 'text/plain; charset=utf-8' }),
    body: null,
    text: async () => body,
  } as Response
}

function binaryResponse(chunks: readonly Uint8Array[], totalLength?: number, status = 200): Response {
  const headers: Record<string, string> = {
    'content-type': 'application/octet-stream',
  }
  if (totalLength !== undefined) {
    headers['content-length'] = String(totalLength)
  }
  return new Response(createChunkedStream(chunks), {
    status,
    headers,
  })
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function assertNeverCalledApiGitHub(url: string): void {
  expect(new URL(url).hostname).not.toBe('api.github.com')
}

describe('GitHubReleaseUpdater and DesktopUpdateCoordinator integration (AC 4–AC 10)', () => {
  it('AC 4: switches to GitHubReleaseUpdater when app-update.yml is absent and probes github.com/releases/latest in 1 request without calling api.github.com', async () => {
    const emptyResourcesDir = makeTempDir('strata-no-app-update-')
    const tempRootDir = makeTempDir('strata-download-tmp-')
    expect(hasPackagedUpdateConfig(emptyResourcesDir)).toBe(false)

    const fetchMock = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = requestUrl(input)
      assertNeverCalledApiGitHub(url)
      expect(url).toBe(LATEST_RELEASE_URL)
      expect(init?.redirect).toBe('manual')
      expect(init?.headers).toEqual({
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'StrataHarness/1.0.1',
      })
      return redirectResponse(releaseTagUrl('strata-v1.0.1'))
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

    const coordinator = new DesktopUpdateCoordinator(
      state => state,
      async () => true,
      source.updater,
      source.enabled,
      () => '1.0.1',
    )
    coordinators.push(coordinator)

    expect(await coordinator.check(true)).toEqual({ phase: 'idle' })
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

  it('AC 5: returns phase idle on HTTP 404, /releases redirect (no stable releases), non-strata or <= currentVersion releases, and surfaces HTTP/XML errors', async () => {
    const idleScenarios: Array<{
      readonly name: string
      readonly fetchImpl: typeof globalThis.fetch
    }> = [
      {
        name: 'HTTP 404 on /releases/latest',
        fetchImpl: vi.fn<typeof globalThis.fetch>(async (input) => {
          assertNeverCalledApiGitHub(requestUrl(input))
          return textResponse('Not Found', 404)
        }),
      },
      {
        name: '302 redirect to /releases (no published stable releases)',
        fetchImpl: vi.fn<typeof globalThis.fetch>(async (input) => {
          assertNeverCalledApiGitHub(requestUrl(input))
          return redirectResponse(`${REPOSITORY_WEB_BASE}/releases`)
        }),
      },
      {
        name: '200 final response at /releases',
        fetchImpl: vi.fn<typeof globalThis.fetch>(async (input) => {
          assertNeverCalledApiGitHub(requestUrl(input))
          const response = textResponse('<html></html>', 200)
          Object.defineProperty(response, 'url', { value: `${REPOSITORY_WEB_BASE}/releases` })
          return response
        }),
      },
      {
        name: '200 final response at /releases/tag/strata-v1.0.1',
        fetchImpl: vi.fn<typeof globalThis.fetch>(async (input) => {
          assertNeverCalledApiGitHub(requestUrl(input))
          const response = textResponse('<html></html>', 200)
          Object.defineProperty(response, 'url', { value: releaseTagUrl('strata-v1.0.1') })
          return response
        }),
      },
      {
        name: '302 intermediate non-github redirect followed by case-variant <= currentVersion tag',
        fetchImpl: vi.fn<typeof globalThis.fetch>(async (input) => {
          const url = requestUrl(input)
          assertNeverCalledApiGitHub(url)
          if (url === LATEST_RELEASE_URL) {
            return redirectResponse('https://mirror.example.com/latest')
          }
          if (url === 'https://mirror.example.com/latest') {
            return redirectResponse(
              releaseTagUrl('strata-v1.0.0', 'https://github.com/CANNONEER85-SVG/StrataHarness-App'),
            )
          }
          throw new Error(`unexpected URL ${url}`)
        }),
      },
      {
        name: 'non-strata latest tag falls back to releases.atom with only non-strata/older/cross-repo/unsafe-checksum tags',
        fetchImpl: vi.fn<typeof globalThis.fetch>(async (input) => {
          const url = requestUrl(input)
          assertNeverCalledApiGitHub(url)
          if (url === LATEST_RELEASE_URL) {
            return redirectResponse(releaseTagUrl('v2.0.0'))
          }
          if (url === RELEASES_ATOM_URL) {
            return atomResponse(
              atomFeed([
                {},
                { linkXml: '<link rel="alternate"/>' },
                { href: 'https://github.com/only-owner' },
                { href: 'https://github.com/owner/repo' },
                { href: 'https://github.com/other-owner/other-repo/releases/tag/strata-v9.9.9' },
                { href: 'https://github.com/deepseek-ai/deepseek-harness/releases/tag/strata-v9.9.9' },
                { href: releaseTagUrl('dsh-v0.2.2-rc.3') },
                { href: releaseTagUrl('v2.0.0') },
                { href: releaseTagUrl('strata-v%ZZ') },
                { href: releaseTagUrl('strata-vnot-semver') },
                { href: releaseTagUrl('strata-v1.0.1%2Bbuild1') },
                { href: releaseTagUrl('strata-v1.0.2'), rel: 'related' },
                { href: releaseTagUrl('strata-v1.0.2') },
                { href: releaseTagUrl('strata-v1.0.1') },
                { href: releaseTagUrl('strata-v1.0.0') },
              ]),
            )
          }
          if (url === releaseDownloadUrl('strata-v1.0.2', 'SHA256SUMS.txt')) {
            const digest = 'a'.repeat(64)
            return textResponse(
              [
                `${digest}  ../evil.exe`,
                `${digest}  sub/path.exe`,
                `${digest}  sub\\path.exe`,
                `${digest}  .`,
                `${digest}  ..`,
                `${digest}  bad\u0007name.exe`,
              ].join('\n'),
            )
          }
          throw new Error(`unexpected URL ${url}`)
        }),
      },
      {
        name: 'non-strata latest tag falls back to releases.atom returning 404',
        fetchImpl: vi.fn<typeof globalThis.fetch>(async (input) => {
          const url = requestUrl(input)
          assertNeverCalledApiGitHub(url)
          if (url === LATEST_RELEASE_URL) {
            return redirectResponse(releaseTagUrl('strata-v%ZZ'))
          }
          if (url === RELEASES_ATOM_URL) {
            return textResponse('Not Found', 404)
          }
          throw new Error(`unexpected URL ${url}`)
        }),
      },
    ]

    for (const scenario of idleScenarios) {
      const updater = new GitHubReleaseUpdater({
        repository: REPOSITORY_URL,
        currentVersion: () => '1.0.1',
        platform: 'win32',
        arch: 'x64',
        fetch: scenario.fetchImpl,
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

    // Error cases surface visibly as phase: 'error', failedOperation: 'check'.
    const errorScenarios: Array<{
      readonly name: string
      readonly fetchImpl: typeof globalThis.fetch
      readonly pattern: RegExp
    }> = [
      {
        name: 'HTTP 503 on /releases/latest',
        fetchImpl: vi.fn<typeof globalThis.fetch>(async () => textResponse('Service Unavailable', 503)),
        pattern: /HTTP 503/u,
      },
      {
        name: 'HTTP 403 on web endpoint',
        fetchImpl: vi.fn<typeof globalThis.fetch>(async () => textResponse('Forbidden', 403)),
        pattern: /HTTP 403/u,
      },
      {
        name: '302 missing Location header',
        fetchImpl: vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 302 })),
        pattern: /missing Location header/u,
      },
      {
        name: '302 malformed Location header',
        fetchImpl: vi.fn<typeof globalThis.fetch>(async () => redirectResponse('http://[::1')),
        pattern: /invalid redirected updater request URL/u,
      },
      {
        name: 'cross-repo /releases redirect is rejected via max redirects rather than masquerading as idle',
        fetchImpl: vi.fn<typeof globalThis.fetch>(async (input) => {
          const url = requestUrl(input)
          if (url === LATEST_RELEASE_URL) {
            return redirectResponse('https://github.com/other-owner/other-repo/releases')
          }
          return redirectResponse(`https://github.com/other-owner/other-repo/releases?hop=${String(url.length)}`)
        }),
        pattern: /exceeded maximum HTTP redirects/u,
      },
      {
        name: 'unexpected 200 HTML page from /releases/latest',
        fetchImpl: vi.fn<typeof globalThis.fetch>(async () => {
          const response = textResponse('<html>unexpected</html>', 200)
          Object.defineProperty(response, 'url', { value: `${REPOSITORY_WEB_BASE}/login` })
          return response
        }),
        pattern: /unexpected response/u,
      },
      {
        name: 'unexpected 200 HTML page with empty response.url',
        fetchImpl: vi.fn<typeof globalThis.fetch>(async () => textResponse('<html>unexpected</html>', 200)),
        pattern: /unexpected response/u,
      },
      {
        name: 'HTTP 503 on releases.atom fallback',
        fetchImpl: vi.fn<typeof globalThis.fetch>(async (input) => {
          if (requestUrl(input) === LATEST_RELEASE_URL) return redirectResponse(releaseTagUrl('v2.0.0'))
          return textResponse('Atom unavailable', 503)
        }),
        pattern: /HTTP 503/u,
      },
      {
        name: 'captive portal HTML returned with 200 from releases.atom',
        fetchImpl: vi.fn<typeof globalThis.fetch>(async (input) => {
          if (requestUrl(input) === LATEST_RELEASE_URL) return redirectResponse(releaseTagUrl('v2.0.0'))
          return textResponse('<html><body>Portal login</body></html>', 200)
        }),
        pattern: /Atom feed is invalid XML/u,
      },
      {
        name: 'oversized streaming releases.atom is aborted before unbounded heap growth',
        fetchImpl: vi.fn<typeof globalThis.fetch>(async (input) => {
          if (requestUrl(input) === LATEST_RELEASE_URL) return redirectResponse(releaseTagUrl('v2.0.0'))
          return new Response(
            createChunkedStream([
              new Uint8Array(0),
              new Uint8Array(1024 * 1024 + 1),
              new Uint8Array(1024 * 1024 + 1),
            ]),
            { status: 200 },
          )
        }),
        pattern: /GitHub Releases Atom feed exceeded maximum size/u,
      },
      {
        name: 'oversized unstreamed SHA256SUMS.txt (body === null) is rejected',
        fetchImpl: vi.fn<typeof globalThis.fetch>(async (input) => {
          const url = requestUrl(input)
          if (url === LATEST_RELEASE_URL) return redirectResponse(releaseTagUrl('strata-v1.0.2'))
          if (url === releaseDownloadUrl('strata-v1.0.2', 'SHA256SUMS.txt')) {
            return unstreamedTextResponse('a'.repeat(65 * 1024), url)
          }
          throw new Error(`unexpected URL ${url}`)
        }),
        pattern: /SHA256SUMS\.txt exceeded maximum size/u,
      },
      {
        name: 'HTTP 502 fetching SHA256SUMS.txt',
        fetchImpl: vi.fn<typeof globalThis.fetch>(async (input) => {
          const url = requestUrl(input)
          if (url === LATEST_RELEASE_URL) return redirectResponse(releaseTagUrl('strata-v1.0.2'))
          if (url === releaseDownloadUrl('strata-v1.0.2', 'SHA256SUMS.txt')) {
            return textResponse('Bad Gateway', 502)
          }
          throw new Error(`unexpected URL ${url}`)
        }),
        pattern: /SHA256SUMS\.txt request failed with HTTP 502/u,
      },
    ]

    for (const scenario of errorScenarios) {
      const updater = new GitHubReleaseUpdater({
        repository: REPOSITORY_URL,
        currentVersion: () => '1.0.1',
        platform: 'win32',
        arch: 'x64',
        fetch: scenario.fetchImpl,
      })
      const coordinator = new DesktopUpdateCoordinator(
        state => state,
        async () => true,
        updater,
        () => true,
        () => '1.0.1',
      )
      coordinators.push(coordinator)
      expect(await coordinator.check(true), scenario.name).toMatchObject({
        phase: 'error',
        failedOperation: 'check',
        message: expect.stringMatching(scenario.pattern) as string,
      })
    }
  })

  it('AC 6: ignores SemVer and Release-Channel prereleases on stable 1.0.1, keeps self-closing Atom links intact, and uses releases.atom on 1.0.1-rc.1', async () => {
    const validHash = sha256Hex('binary')

    // 1. Stable installed 1.0.1: /releases/latest points to prerelease tag -> falls back to releases.atom ->
    // ignores both -rc tags and plain-tag Release Channel: Prerelease / Draft entries -> idle.
    const stableFallbackFetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = requestUrl(input)
      assertNeverCalledApiGitHub(url)
      if (url === LATEST_RELEASE_URL) {
        return redirectResponse(releaseTagUrl('strata-v1.0.3-rc.1'))
      }
      if (url === RELEASES_ATOM_URL) {
        return atomResponse(
          atomFeed([
            { href: releaseTagUrl('strata-v1.0.3-rc.1') },
            { href: releaseTagUrl('strata-v1.0.2-rc.2') },
            {
              href: releaseTagUrl('strata-v1.0.2'),
              contentHtml: '&lt;ul&gt;&lt;li&gt;Release Channel: Prerelease&lt;/li&gt;&lt;/ul&gt;',
            },
            { href: releaseTagUrl('strata-v1.0.1') },
          ]),
        )
      }
      throw new Error(`unexpected URL ${url}`)
    })
    const stableUpdater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1',
      platform: 'win32',
      arch: 'x64',
      fetch: stableFallbackFetch,
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

    // 2. Stable installed 1.0.1: /releases/latest points to stable 1.0.2 while newer prerelease exists -> selects 1.0.2.
    const stableWinFetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = requestUrl(input)
      assertNeverCalledApiGitHub(url)
      if (url === LATEST_RELEASE_URL) {
        return redirectResponse(releaseTagUrl('strata-v1.0.2'))
      }
      if (url === releaseDownloadUrl('strata-v1.0.2', 'SHA256SUMS.txt')) {
        return textResponse(`${validHash}  strataharness-1.0.2-win-x64-unsigned.exe\n`)
      }
      throw new Error(`unexpected URL ${url}`)
    })
    const mixedUpdater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1',
      platform: 'win32',
      arch: 'x64',
      fetch: stableWinFetch,
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
    expect(stableWinFetch).toHaveBeenCalledTimes(2)

    // 3. Prerelease installed 1.0.1-rc.1 on nightly channel parses self-closing <summary/> before <link>,
    // ignores links inside paired <content>/<summary>, handles malformed/non-github/non-release links, and picks 1.0.3-rc.1.
    const prereleaseFetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = requestUrl(input)
      assertNeverCalledApiGitHub(url)
      if (url === RELEASES_ATOM_URL) {
        expect(init?.headers).toEqual({
          Accept: 'application/atom+xml, application/xml, text/xml',
          'User-Agent': 'StrataHarness/1.0.1-rc.1',
        })
        return atomResponse(
          atomFeed([
            { href: 'http://[::1' },
            { href: 'https://gitlab.com/owner/repo/releases/tag/strata-v9.0.0' },
            { href: `${REPOSITORY_WEB_BASE}/commits/main` },
            {
              href: releaseTagUrl('strata-v1.0.2-rc.2'),
              summaryHtml: `&lt;a href="${releaseTagUrl('strata-v9.9.9')}"&gt;link&lt;/a&gt;`,
              contentHtml: `&lt;a href="${releaseTagUrl('strata-v8.8.8')}"&gt;link&lt;/a&gt;`,
            },
            {
              prefixXml: '<summary type="html"/><content type="html"/>',
              href: `${releaseTagUrl('strata-v1.0.3-rc.1')}?foo=1&amp;bar=2`,
              rel: 'alternate',
              quote: '\'',
            },
            {
              href: releaseTagUrl('strata-v1.0.3-rc.1'),
              rel: null,
            },
            {
              href: releaseTagUrl('strata-v1.0.1'),
            },
          ]),
        )
      }
      if (url === releaseDownloadUrl('strata-v1.0.3-rc.1', 'SHA256SUMS.txt')) {
        return unstreamedTextResponse(`${validHash}  strataharness-1.0.3-rc.1-win-x64-unsigned.exe\n`, url)
      }
      throw new Error(`unexpected URL ${url}`)
    })
    const prereleaseUpdater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1-rc.1',
      platform: 'win32',
      arch: 'x64',
      fetch: prereleaseFetch,
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

    // 4. Prerelease installed version switched to 'stable' channel ignores prereleases and probes /releases/latest.
    const stableChannelPrereleaseUpdater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1-rc.1',
      platform: 'win32',
      arch: 'x64',
      fetch: vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = requestUrl(input)
        assertNeverCalledApiGitHub(url)
        if (url === LATEST_RELEASE_URL) return redirectResponse(`${REPOSITORY_WEB_BASE}/releases`)
        throw new Error(`unexpected URL ${url}`)
      }),
    })
    stableChannelPrereleaseUpdater.channel = 'stable'
    expect(await stableChannelPrereleaseUpdater.checkForUpdates()).toEqual({
      isUpdateAvailable: false,
      updateInfo: { version: '1.0.1-rc.1' },
    })
  })

  it('Q2: enforces maxStableVersion ceiling, skips incomplete or other-platform releases, and caps sequential probes at 5', async () => {
    const validHash = sha256Hex('win-installer')

    // Case 1: Latest stable 1.0.3 returns 404 on SHA256SUMS.txt (still uploading);
    // releases.atom lists a newer GitHub prerelease plain-tag 1.0.4, 1.0.3, and complete 1.0.2 ->
    // skips 1.0.4 (> maxStableVersion 1.0.3), skips re-querying 1.0.3, and picks 1.0.2.
    const requestedUrls: string[] = []
    const fallbackUpdater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1',
      platform: 'win32',
      arch: 'x64',
      fetch: vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = requestUrl(input)
        assertNeverCalledApiGitHub(url)
        requestedUrls.push(url)
        if (url === LATEST_RELEASE_URL) return redirectResponse(releaseTagUrl('strata-v1.0.3'))
        if (url === releaseDownloadUrl('strata-v1.0.3', 'SHA256SUMS.txt')) return textResponse('Not Found', 404)
        if (url === RELEASES_ATOM_URL) {
          return atomResponse(
            atomFeed([
              { href: releaseTagUrl('strata-v1.0.4') },
              { href: releaseTagUrl('strata-v1.0.3') },
              { href: releaseTagUrl('strata-v1.0.2') },
              { href: releaseTagUrl('strata-v1.0.1') },
            ]),
          )
        }
        if (url === releaseDownloadUrl('strata-v1.0.2', 'SHA256SUMS.txt')) {
          return textResponse(`${validHash}  strataharness-1.0.2-win-x64-unsigned.exe\n`)
        }
        throw new Error(`unexpected URL ${url}`)
      }),
    })
    const fallbackCoordinator = new DesktopUpdateCoordinator(
      state => state,
      async () => true,
      fallbackUpdater,
      () => true,
      () => '1.0.1',
    )
    coordinators.push(fallbackCoordinator)
    expect(await fallbackCoordinator.check(true)).toEqual({ phase: 'available', version: '1.0.2' })
    expect(requestedUrls).toEqual([
      LATEST_RELEASE_URL,
      releaseDownloadUrl('strata-v1.0.3', 'SHA256SUMS.txt'),
      RELEASES_ATOM_URL,
      releaseDownloadUrl('strata-v1.0.2', 'SHA256SUMS.txt'),
    ])

    // Case 2: Latest 1.0.3 only has mac-arm64 in SHA256SUMS.txt and no older > 1.0.1 exists -> idle.
    const singlePlatformUpdater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1',
      platform: 'win32',
      arch: 'x64',
      fetch: vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = requestUrl(input)
        if (url === LATEST_RELEASE_URL) return redirectResponse(releaseTagUrl('strata-v1.0.3'))
        if (url === releaseDownloadUrl('strata-v1.0.3', 'SHA256SUMS.txt')) {
          return textResponse(`${validHash}  strataharness-1.0.3-mac-arm64-unsigned.dmg\n`)
        }
        if (url === RELEASES_ATOM_URL) {
          return atomResponse(atomFeed([{ href: releaseTagUrl('strata-v1.0.3') }, { href: releaseTagUrl('strata-v1.0.1') }]))
        }
        throw new Error(`unexpected URL ${url}`)
      }),
    })
    const singleCoordinator = new DesktopUpdateCoordinator(
      state => state,
      async () => true,
      singlePlatformUpdater,
      () => true,
      () => '1.0.1',
    )
    coordinators.push(singleCoordinator)
    expect(await singleCoordinator.check(true)).toEqual({ phase: 'idle' })

    // Case 3: Prerelease stream skips single-platform 1.0.3-rc.1 and empty SHA256SUMS.txt 1.0.2-rc.3, selects 1.0.2-rc.2.
    const prereleaseFallbackUpdater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1-rc.1',
      platform: 'win32',
      arch: 'x64',
      fetch: vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = requestUrl(input)
        if (url === RELEASES_ATOM_URL) {
          return atomResponse(
            atomFeed([
              { href: releaseTagUrl('strata-v1.0.3-rc.1') },
              { href: releaseTagUrl('strata-v1.0.2-rc.3') },
              { href: releaseTagUrl('strata-v1.0.2-rc.2') },
              { href: releaseTagUrl('strata-v1.0.1-rc.1') },
            ]),
          )
        }
        if (url === releaseDownloadUrl('strata-v1.0.3-rc.1', 'SHA256SUMS.txt')) {
          return textResponse(`${validHash}  strataharness-1.0.3-rc.1-mac-arm64-unsigned.dmg\n`)
        }
        if (url === releaseDownloadUrl('strata-v1.0.2-rc.3', 'SHA256SUMS.txt')) {
          return textResponse('')
        }
        if (url === releaseDownloadUrl('strata-v1.0.2-rc.2', 'SHA256SUMS.txt')) {
          return textResponse(`${validHash}  strataharness-1.0.2-rc.2-win-x64-unsigned.exe\n`)
        }
        throw new Error(`unexpected URL ${url}`)
      }),
    })
    expect(await prereleaseFallbackUpdater.checkForUpdates()).toEqual({
      isUpdateAvailable: true,
      updateInfo: { version: '1.0.2-rc.2' },
    })

    // Case 4: Caps SHA256SUMS.txt candidate probes at 5 across checkForUpdates().
    const probedTags: string[] = []
    const cappedUpdater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.0',
      platform: 'win32',
      arch: 'x64',
      fetch: vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = requestUrl(input)
        if (url === LATEST_RELEASE_URL) return redirectResponse(releaseTagUrl('strata-v1.0.7'))
        if (url === RELEASES_ATOM_URL) {
          return atomResponse(
            atomFeed([
              { href: releaseTagUrl('strata-v1.0.7') },
              { href: releaseTagUrl('strata-v1.0.6') },
              { href: releaseTagUrl('strata-v1.0.5') },
              { href: releaseTagUrl('strata-v1.0.4') },
              { href: releaseTagUrl('strata-v1.0.3') },
              { href: releaseTagUrl('strata-v1.0.2') },
              { href: releaseTagUrl('strata-v1.0.1') },
            ]),
          )
        }
        const tag = /\/releases\/download\/([^/]+)\/SHA256SUMS\.txt$/u.exec(url)?.[1]
        if (tag !== undefined) {
          probedTags.push(tag)
          return textResponse('Not Found', 404)
        }
        throw new Error(`unexpected URL ${url}`)
      }),
    })
    expect(await cappedUpdater.checkForUpdates()).toEqual({
      isUpdateAvailable: false,
      updateInfo: { version: '1.0.0' },
    })
    expect(probedTags).toEqual([
      'strata-v1.0.7',
      'strata-v1.0.6',
      'strata-v1.0.5',
      'strata-v1.0.4',
      'strata-v1.0.3',
    ])

    // Case 5: Unsupported runtime platform surfaces immediately instead of silently returning idle.
    const unsupportedPlatformUpdater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1',
      platform: 'linux',
      arch: 'x64',
      fetch: vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = requestUrl(input)
        if (url === LATEST_RELEASE_URL) return redirectResponse(releaseTagUrl('strata-v1.0.2'))
        if (url === releaseDownloadUrl('strata-v1.0.2', 'SHA256SUMS.txt')) {
          return textResponse(`${validHash}  strataharness-1.0.2-win-x64.exe\n`)
        }
        throw new Error(`unexpected URL ${url}`)
      }),
    })
    await expect(unsupportedPlatformUpdater.checkForUpdates()).rejects.toThrow(/unsupported platform target linux-x64/u)
  })

  it('AC 7: prioritizes signed installer assets over -unsigned and validates SHA256SUMS.txt entries', async () => {
    expect(resolveGitHubReleasePlatformTarget('win32', 'x64')).toEqual({ target: 'win-x64', extension: 'exe' })
    expect(resolveGitHubReleasePlatformTarget('darwin', 'arm64')).toEqual({ target: 'mac-arm64', extension: 'dmg' })
    expect(resolveGitHubReleasePlatformTarget('darwin', 'x64')).toEqual({ target: 'mac-x64', extension: 'dmg' })
    expect(() => resolveGitHubReleasePlatformTarget('linux', 'x64')).toThrow(/unsupported platform target/u)

    const checksumsAsset = {
      name: 'SHA256SUMS.txt',
      browserDownloadUrl: releaseDownloadUrl('strata-v1.0.2', 'SHA256SUMS.txt'),
    }
    const unsignedWinAsset = {
      name: 'strataharness-1.0.2-win-x64-unsigned.exe',
      browserDownloadUrl: releaseDownloadUrl('strata-v1.0.2', 'strataharness-1.0.2-win-x64-unsigned.exe'),
    }
    const signedWinAsset = {
      name: 'strataharness-1.0.2-win-x64.exe',
      browserDownloadUrl: releaseDownloadUrl('strata-v1.0.2', 'strataharness-1.0.2-win-x64.exe'),
    }

    const bothSelected = selectGitHubReleaseAssets(
      '1.0.2',
      [unsignedWinAsset, signedWinAsset, checksumsAsset],
      'win32',
      'x64',
    )
    expect(bothSelected.signed).toBe(true)
    expect(bothSelected.installerAsset.name).toBe('strataharness-1.0.2-win-x64.exe')

    const unsignedSelected = selectGitHubReleaseAssets(
      '1.0.2',
      [unsignedWinAsset, checksumsAsset],
      'win32',
      'x64',
    )
    expect(unsignedSelected.signed).toBe(false)
    expect(unsignedSelected.installerAsset.name).toBe('strataharness-1.0.2-win-x64-unsigned.exe')

    const macArmSelected = selectGitHubReleaseAssets(
      '1.0.2',
      [
        {
          name: 'strataharness-1.0.2-mac-arm64-unsigned.dmg',
          browserDownloadUrl: releaseDownloadUrl('strata-v1.0.2', 'strataharness-1.0.2-mac-arm64-unsigned.dmg'),
        },
        checksumsAsset,
      ],
      'darwin',
      'arm64',
    )
    expect(macArmSelected.target).toBe('mac-arm64')
    expect(macArmSelected.installerAsset.name).toBe('strataharness-1.0.2-mac-arm64-unsigned.dmg')

    expect(() => selectGitHubReleaseAssets('1.0.2', [checksumsAsset], 'win32', 'x64')).toThrow(/missing installer asset/u)
    expect(() => selectGitHubReleaseAssets('1.0.2', [signedWinAsset], 'win32', 'x64')).toThrow(/missing SHA256SUMS\.txt/u)
    expect(() => selectGitHubReleaseAssets('1.0.2', [
      { name: 'strataharness-1.0.2-win-x64.exe', browserDownloadUrl: 'not-a-valid-url' },
      checksumsAsset,
    ], 'win32', 'x64')).toThrow(/invalid installer asset/u)

    // When SHA256SUMS.txt explicitly lists SHA256SUMS.txt alongside both signed and unsigned installers,
    // GitHubReleaseUpdater selects the signed installer without duplicating SHA256SUMS.txt.
    const signedBinary = Buffer.from('signed-installer-payload')
    const signedHash = sha256Hex(signedBinary)
    const tempRootDir = makeTempDir('strata-ac7-signed-')
    const updater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1',
      platform: 'win32',
      arch: 'x64',
      tempRootDir,
      fetch: vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = requestUrl(input)
        if (url === LATEST_RELEASE_URL) return redirectResponse(releaseTagUrl('strata-v1.0.2'))
        if (url === releaseDownloadUrl('strata-v1.0.2', 'SHA256SUMS.txt')) {
          return textResponse([
            `${'b'.repeat(64)}  SHA256SUMS.txt`,
            `${signedHash}  strataharness-1.0.2-win-x64-unsigned.exe`,
            `${signedHash}  strataharness-1.0.2-win-x64.exe`,
          ].join('\n'))
        }
        if (url === releaseDownloadUrl('strata-v1.0.2', 'strataharness-1.0.2-win-x64.exe')) {
          return binaryResponse([signedBinary], signedBinary.byteLength)
        }
        throw new Error(`unexpected URL ${url}`)
      }),
    })
    expect(await updater.checkForUpdates()).toEqual({ isUpdateAvailable: true, updateInfo: { version: '1.0.2' } })
    const [downloadedPath] = await updater.downloadUpdate()
    expect(downloadedPath).toContain('strataharness-1.0.2-win-x64.exe')
    await updater.discard()
  })

  it('AC 8: streams installer with 0%..100% progress (with and without Content-Length and buffered fallback), verifies SHA256SUMS.txt, and transitions to ready', async () => {
    const tempRootDir = makeTempDir('strata-ac8-tmp-')
    const chunk1 = Buffer.from('strata-installer-part-1-')
    const chunk2 = Buffer.from('strata-installer-part-2-final')
    const fullBinary = Buffer.concat([chunk1, chunk2])
    const expectedHash = sha256Hex(fullBinary).toUpperCase()

    const installerUrl = releaseDownloadUrl('strata-v1.0.2', 'strataharness-1.0.2-win-x64-unsigned.exe')
    const checksumsUrl = releaseDownloadUrl('strata-v1.0.2', 'SHA256SUMS.txt')
    const checksumsBody = [
      `${sha256Hex('other')}  strataharness-1.0.2-mac-arm64-unsigned.dmg`,
      `${expectedHash} *strataharness-1.0.2-win-x64-unsigned.exe`,
    ].join('\n')

    const fetchMock = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = requestUrl(input)
      assertNeverCalledApiGitHub(url)
      if (url === LATEST_RELEASE_URL) return redirectResponse(releaseTagUrl('strata-v1.0.2'))
      if (url === checksumsUrl) return textResponse(checksumsBody)
      if (url === installerUrl) return binaryResponse([chunk1, chunk2], fullBinary.byteLength)
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

    expect(states[0]).toEqual({ phase: 'available', version: '1.0.2' })
    expect(states.some(s => s.phase === 'downloading' && s.percent === 0)).toBe(true)
    expect(states.some(s => s.phase === 'downloading' && (s.percent ?? 0) > 0 && (s.percent ?? 0) < 100)).toBe(true)
    expect(states.some(s => s.phase === 'verifying' && s.percent === 100)).toBe(true)
    expect(states.at(-1)).toEqual({ phase: 'ready', version: '1.0.2' })
    expect(updater.preparedInstallerPath).toBeDefined()
    expect(readFileSync(updater.preparedInstallerPath!)).toEqual(fullBinary)

    // Direct downloadUpdate() without prior checkForUpdates(), unknown Content-Length + zero-byte chunk, and discard() cleanup.
    const noLengthDir = makeTempDir('strata-ac8-nolength-')
    const noLengthUpdater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1',
      platform: 'win32',
      arch: 'x64',
      tempRootDir: noLengthDir,
      fetch: vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = requestUrl(input)
        if (url === LATEST_RELEASE_URL) return redirectResponse(releaseTagUrl('strata-v1.0.2'))
        if (url === checksumsUrl) return textResponse(checksumsBody)
        if (url === installerUrl) return binaryResponse([chunk1, new Uint8Array(0), chunk2])
        throw new Error(`unexpected URL ${url}`)
      }),
    })
    const noLengthPercents: number[] = []
    noLengthUpdater.on('download-progress', (p: { percent: number }) => { noLengthPercents.push(p.percent) })
    const paths = await noLengthUpdater.downloadUpdate()
    expect(paths).toHaveLength(1)
    expect(noLengthPercents).toEqual([0, 1, 2, 100])
    await noLengthUpdater.discard()
    expect(noLengthUpdater.preparedInstallerPath).toBeUndefined()
    expect(readdirSync(noLengthDir)).toEqual([])

    // Non-streaming Response with body === null falls back to arrayBuffer().
    const arrayBufferDir = makeTempDir('strata-ac8-arraybuf-')
    const arrayBufferUpdater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1',
      platform: 'win32',
      arch: 'x64',
      tempRootDir: arrayBufferDir,
      fetch: vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = requestUrl(input)
        if (url === LATEST_RELEASE_URL) return redirectResponse(releaseTagUrl('strata-v1.0.2'))
        if (url === checksumsUrl) return textResponse(checksumsBody)
        if (url === installerUrl) {
          return {
            ok: true,
            status: 200,
            url: installerUrl,
            headers: new Headers(),
            body: null,
            arrayBuffer: async () => fullBinary.buffer.slice(fullBinary.byteOffset, fullBinary.byteOffset + fullBinary.byteLength),
          } as Response
        }
        throw new Error(`unexpected URL ${url}`)
      }),
    })
    const bufferedPercents: number[] = []
    arrayBufferUpdater.on('download-progress', (p: { percent: number }) => { bufferedPercents.push(p.percent) })
    await arrayBufferUpdater.downloadUpdate()
    expect(bufferedPercents).toEqual([0, 99, 100])
    await arrayBufferUpdater.discard()
  })

  it('AC 9: deletes temporary files immediately and returns phase error (failedOperation: download) on installer/checksums failure or SHA-256 mismatch', async () => {
    const binaryData = Buffer.from('corrupted-or-unverified-binary-payload')
    const validHash = sha256Hex(binaryData)
    const wrongHash = '0'.repeat(64)

    const installerUrl = releaseDownloadUrl('strata-v1.0.2', 'strataharness-1.0.2-win-x64-unsigned.exe')
    const checksumsUrl = releaseDownloadUrl('strata-v1.0.2', 'SHA256SUMS.txt')

    // Direct downloadUpdate() with no available release rejects cleanly.
    const noReleaseUpdater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1',
      fetch: vi.fn<typeof globalThis.fetch>(async () => textResponse('Not Found', 404)),
    })
    await expect(noReleaseUpdater.downloadUpdate()).rejects.toThrow(/no GitHub release is available to download/u)
    await noReleaseUpdater.discard()

    const failureCases: Array<{
      readonly name: string
      readonly onInstaller: () => Response
      readonly onSecondChecksums: () => Response
      readonly pattern: RegExp
    }> = [
      {
        name: 'installer HTTP 500 error',
        onInstaller: () => textResponse('Server Error', 500),
        onSecondChecksums: () => textResponse(`${validHash}  strataharness-1.0.2-win-x64-unsigned.exe\n`),
        pattern: /installer download failed with HTTP 500/u,
      },
      {
        name: 'empty installer stream',
        onInstaller: () => binaryResponse([new Uint8Array(0)], 0),
        onSecondChecksums: () => textResponse(`${validHash}  strataharness-1.0.2-win-x64-unsigned.exe\n`),
        pattern: /downloaded installer .* is empty/u,
      },
      {
        name: 'empty buffered installer (body === null)',
        onInstaller: () => ({
          ok: true,
          status: 200,
          url: installerUrl,
          headers: new Headers(),
          body: null,
          arrayBuffer: async () => new ArrayBuffer(0),
        } as Response),
        onSecondChecksums: () => textResponse(`${validHash}  strataharness-1.0.2-win-x64-unsigned.exe\n`),
        pattern: /downloaded installer .* is empty/u,
      },
      {
        name: 'SHA256SUMS.txt HTTP 404 during downloadUpdate()',
        onInstaller: () => binaryResponse([binaryData], binaryData.byteLength),
        onSecondChecksums: () => textResponse('Not Found', 404),
        pattern: /SHA256SUMS\.txt download failed with HTTP 404/u,
      },
      {
        name: 'oversized SHA256SUMS.txt stream during downloadUpdate()',
        onInstaller: () => binaryResponse([binaryData], binaryData.byteLength),
        onSecondChecksums: () => new Response(createChunkedStream([new Uint8Array(65 * 1024)]), { status: 200 }),
        pattern: /SHA256SUMS\.txt exceeded maximum size/u,
      },
      {
        name: 'installer filename missing in refreshed SHA256SUMS.txt',
        onInstaller: () => binaryResponse([binaryData], binaryData.byteLength),
        onSecondChecksums: () => textResponse(`${validHash}  strataharness-1.0.2-mac-arm64-unsigned.dmg\n`),
        pattern: /SHA256SUMS\.txt does not contain an entry/u,
      },
      {
        name: 'SHA-256 digest mismatch against SHA256SUMS.txt',
        onInstaller: () => binaryResponse([binaryData], binaryData.byteLength),
        onSecondChecksums: () => textResponse(`${wrongHash}  strataharness-1.0.2-win-x64-unsigned.exe\n`),
        pattern: /SHA-256 verification failed/u,
      },
    ]

    for (const testCase of failureCases) {
      const tempRootDir = makeTempDir('strata-ac9-tmp-')
      let checksumsRequests = 0
      const updater = new GitHubReleaseUpdater({
        repository: REPOSITORY_URL,
        currentVersion: () => '1.0.1',
        platform: 'win32',
        arch: 'x64',
        tempRootDir,
        fetch: vi.fn<typeof globalThis.fetch>(async (input) => {
          const url = requestUrl(input)
          if (url === LATEST_RELEASE_URL) return redirectResponse(releaseTagUrl('strata-v1.0.2'))
          if (url === checksumsUrl) {
            checksumsRequests += 1
            return checksumsRequests === 1
              ? textResponse(`${validHash}  strataharness-1.0.2-win-x64-unsigned.exe\n`)
              : testCase.onSecondChecksums()
          }
          if (url === installerUrl) return testCase.onInstaller()
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
        message: expect.stringMatching(testCase.pattern) as string,
      })
      expect(updater.preparedInstallerPath, testCase.name).toBeUndefined()
      expect(readdirSync(tempRootDir), `${testCase.name}: temp directory cleaned up`).toEqual([])
    }
  })

  it('AC 10 (win32): spawns verified .exe with detached: true, stdio: ignore, windowsHide: false, calls unref() and quit() on spawn, and handles spawn errors and edge cases', async () => {
    const tempRootDir = makeTempDir('strata-ac10-win-')
    const binaryData = Buffer.from('windows-nsis-installer-binary')
    const validHash = sha256Hex(binaryData)
    const installerUrl = releaseDownloadUrl('strata-v1.0.2', 'strataharness-1.0.2-win-x64.exe')
    const checksumsUrl = releaseDownloadUrl('strata-v1.0.2', 'SHA256SUMS.txt')

    const webFetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = requestUrl(input)
      if (url === LATEST_RELEASE_URL) return redirectResponse(releaseTagUrl('strata-v1.0.2'))
      if (url === checksumsUrl) return textResponse(`${validHash}  strataharness-1.0.2-win-x64.exe\n`)
      if (url === installerUrl) return binaryResponse([binaryData], binaryData.byteLength)
      throw new Error(`unexpected URL ${url}`)
    })

    // Calling quitAndInstall before downloading emits an error.
    const unreadyUpdater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1',
      platform: 'win32',
      arch: 'x64',
    })
    const unreadyErrors: Error[] = []
    unreadyUpdater.on('error', (err: Error) => unreadyErrors.push(err))
    unreadyUpdater.quitAndInstall()
    expect(unreadyErrors[0]?.message).toMatch(/no verified installer is ready to launch/u)

    const unrefMock = vi.fn()
    let spawnedChild: EventEmitter | undefined
    const spawnMock = vi.fn<SpawnInstallerProcess>(() => {
      const child = Object.assign(new EventEmitter(), { unref: unrefMock })
      spawnedChild = child
      const listeners: Partial<Record<'spawn' | 'error', (...args: unknown[]) => void>> = {}
      const wrappedOnce = child.once.bind(child)
      child.once = ((event: 'spawn' | 'error', listener: (...args: unknown[]) => void) => {
        listeners[event] = listener
        return wrappedOnce(event, listener)
      }) as typeof child.once
      queueMicrotask(() => {
        child.emit('spawn')
        listeners.error?.(new Error('late error after settled'))
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
      fetch: webFetch,
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
    await vi.waitFor(() => {
      expect(spawnedChild).toBeDefined()
      expect(unrefMock).toHaveBeenCalledOnce()
      expect(quitMock).toHaveBeenCalledOnce()
    })

    // Child without .once falls back to immediate unref() and default quit().
    const immediateUnref = vi.fn()
    const immediateUpdater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1',
      platform: 'win32',
      arch: 'x64',
      tempRootDir,
      spawn: () => ({ unref: immediateUnref }),
      fetch: webFetch,
    })
    await immediateUpdater.downloadUpdate()
    immediateUpdater.quitAndInstall()
    expect(immediateUnref).toHaveBeenCalledOnce()
    await immediateUpdater.discard()

    // Asynchronous Error/non-Error and synchronous Error/non-Error throws on spawn emit install error without quitting.
    for (const mode of ['async-error', 'async-string', 'sync-error', 'sync-string'] as const) {
      const failingUnref = vi.fn()
      const failingQuit = vi.fn()
      const failingSpawn = vi.fn<SpawnInstallerProcess>(() => {
        if (mode === 'sync-error') {
          throw new Error('sync spawn failure')
        }
        if (mode === 'sync-string') {
          throw 'sync spawn string'
        }
        const child = Object.assign(new EventEmitter(), { unref: failingUnref })
        const listeners: Partial<Record<'spawn' | 'error', (...args: unknown[]) => void>> = {}
        const wrappedOnce = child.once.bind(child)
        child.once = ((event: 'spawn' | 'error', listener: (...args: unknown[]) => void) => {
          listeners[event] = listener
          return wrappedOnce(event, listener)
        }) as typeof child.once
        queueMicrotask(() => {
          child.emit('error', mode === 'async-error' ? new Error('spawn EACCES') : 'spawn EACCES string')
          listeners.spawn?.()
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
        fetch: webFetch,
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
      await vi.waitFor(() => {
        expect(failingCoordinator.state).toMatchObject({
          phase: 'error',
          version: '1.0.2',
          failedOperation: 'install',
          message: expect.stringMatching(
            mode === 'sync-error'
              ? /sync spawn failure/u
              : mode === 'sync-string'
                ? /sync spawn string/u
                : /spawn EACCES/u,
          ) as string,
        })
      })
      expect(failingUnref).not.toHaveBeenCalled()
      expect(failingQuit).not.toHaveBeenCalled()
    }
  })

  it('AC 10 (darwin): opens verified .dmg via openInstaller (shell.openPath) and calls quit() on empty error string, or emits install error on failure', async () => {
    const tempRootDir = makeTempDir('strata-ac10-mac-')
    const dmgData = Buffer.from('macos-disk-image-payload')
    const validHash = sha256Hex(dmgData)
    const dmgUrl = releaseDownloadUrl('strata-v1.0.2', 'strataharness-1.0.2-mac-arm64-unsigned.dmg')
    const checksumsUrl = releaseDownloadUrl('strata-v1.0.2', 'SHA256SUMS.txt')

    const macFetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = requestUrl(input)
      if (url === LATEST_RELEASE_URL) return redirectResponse(releaseTagUrl('strata-v1.0.2'))
      if (url === checksumsUrl) return textResponse(`${validHash}  strataharness-1.0.2-mac-arm64-unsigned.dmg\n`)
      if (url === dmgUrl) return binaryResponse([dmgData], dmgData.byteLength)
      throw new Error(`unexpected URL ${url}`)
    })

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
      fetch: macFetch,
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
    await vi.waitFor(() => {
      expect(openInstallerMock).toHaveBeenCalledExactlyOnceWith(verifiedDmgPath)
      expect(quitMock).toHaveBeenCalledOnce()
    })

    // Non-empty openPath error, rejected Error, and default omitted openInstaller all surface install errors.
    for (const mode of ['non-empty', 'string-reject', 'default-omitted'] as const) {
      const failingOpenQuit = vi.fn()
      const openInstallerFn = mode === 'non-empty'
        ? async () => 'Failed to mount disk image'
        : async () => { throw 'openPath rejected' }
      const failingUpdater = new GitHubReleaseUpdater({
        repository: REPOSITORY_URL,
        currentVersion: () => '1.0.1',
        platform: 'darwin',
        arch: 'arm64',
        tempRootDir,
        ...(mode === 'default-omitted' ? {} : { openInstaller: openInstallerFn }),
        quit: failingOpenQuit,
        fetch: macFetch,
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
      await vi.waitFor(() => {
        expect(failingCoordinator.state).toMatchObject({
          phase: 'error',
          version: '1.0.2',
          failedOperation: 'install',
          message: expect.stringMatching(
            mode === 'non-empty'
              ? /Failed to mount disk image/u
              : mode === 'string-reject'
                ? /openPath rejected/u
                : /macOS installer opener is not configured/u,
          ) as string,
        })
      })
      expect(failingOpenQuit).not.toHaveBeenCalled()
    }
  })

  it('parses SHA256SUMS.txt, validates constructor options, enforces timeouts, and blocks unsafe redirects', async () => {
    const digestA = 'a'.repeat(64)
    const digestB = 'B'.repeat(64)
    const parsed = parseSha256Sums(
      [
        '# comment line',
        'malformed line without sha256',
        `${digestA}  ./`,
        `${digestA}  strataharness-1.0.2-win-x64.exe`,
        `${digestB} *./strataharness-1.0.2-mac-arm64.dmg`,
        '',
      ].join('\r\n'),
    )
    expect(parsed.get('strataharness-1.0.2-win-x64.exe')).toBe(digestA)
    expect(parsed.get('strataharness-1.0.2-mac-arm64.dmg')).toBe(digestB.toLowerCase())
    expect(parsed.size).toBe(2)

    // Constructor validation.
    expect(() => new GitHubReleaseUpdater({
      repository: 'https://gitlab.com/owner/repo.git',
      currentVersion: () => '1.0.1',
    })).toThrow(/invalid GitHub release repository/u)
    expect(() => new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1',
      timeoutMs: 500,
    })).toThrow(/HTTP idle timeout must be an integer/u)

    // Blocks insecure redirect targets and DeepSeek domains in both probeLatestStableRelease and openTimedResponse.
    const requestedUrls: string[] = []
    const redirectUpdater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1',
      fetch: vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = requestUrl(input)
        requestedUrls.push(url)
        return redirectResponse('http://insecure.example.com/releases/tag/strata-v1.0.2')
      }),
    })
    await expect(redirectUpdater.checkForUpdates()).rejects.toThrow(/must use HTTPS/u)
    expect(requestedUrls).toEqual([LATEST_RELEASE_URL])

    // Blocks malformed redirect and DeepSeek redirect inside openTimedResponse (Atom feed request) and respects MAX_HTTP_REDIRECTS.
    const malformedAtomRedirectUpdater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1-rc.1',
      fetch: vi.fn<typeof globalThis.fetch>(async () => redirectResponse('http://[::1')),
    })
    await expect(malformedAtomRedirectUpdater.checkForUpdates()).rejects.toThrow(/invalid redirected updater request URL/u)

    const atomRedirectUpdater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1-rc.1',
      fetch: vi.fn<typeof globalThis.fetch>(async () =>
        redirectResponse('https://download.deepseek.com/releases.atom')),
    })
    await expect(atomRedirectUpdater.checkForUpdates()).rejects.toThrow(/DeepSeek update domains are blocked/u)

    const atomLoopUpdater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1-rc.1',
      fetch: vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = requestUrl(input)
        const hop = url === RELEASES_ATOM_URL ? 1 : Number(url.split('hop=')[1] ?? '0') + 1
        return redirectResponse(`${RELEASES_ATOM_URL}?hop=${String(hop)}`)
      }),
    })
    await expect(atomLoopUpdater.checkForUpdates()).rejects.toThrow(/exceeded maximum HTTP redirects/u)

    const atomSilentRedirectUpdater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1-rc.1',
      fetch: vi.fn<typeof globalThis.fetch>(async () => {
        const res = new Response(null, { status: 302 })
        Object.defineProperty(res, 'url', { value: 'https://download.deepseek.com/evil' })
        return res
      }),
    })
    await expect(atomSilentRedirectUpdater.checkForUpdates()).rejects.toThrow(/DeepSeek update domains are blocked/u)

    // Idle timeout aborts stalled fetch cleanly (ETIMEDOUT) and contains cancel() errors on aborted probe bodies.
    vi.useFakeTimers()
    const stalledUpdater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1',
      timeoutMs: 1000,
      fetch: vi.fn<typeof globalThis.fetch>((_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const reason: unknown = init.signal?.reason
          reject(reason instanceof Error ? reason : new Error('aborted'))
        })
      })),
    })
    const checkPromise = stalledUpdater.checkForUpdates()
    const rejectionAssertion = expect(checkPromise).rejects.toMatchObject({ code: 'ETIMEDOUT' })
    await vi.advanceTimersByTimeAsync(1000)
    await rejectionAssertion
    vi.useRealTimers()

    // Erroring response body cancel on 404 probe does not mask the clean idle result.
    const cancelErrorStream = new ReadableStream({
      cancel() {
        throw new Error('stream cancel error')
      },
    })
    const cancelRes = new Response(cancelErrorStream, { status: 404 })
    const cancelUpdater = new GitHubReleaseUpdater({
      repository: REPOSITORY_URL,
      currentVersion: () => '1.0.1',
      fetch: vi.fn<typeof globalThis.fetch>(async () => cancelRes),
    })
    expect(await cancelUpdater.checkForUpdates()).toEqual({
      isUpdateAvailable: false,
      updateInfo: { version: '1.0.1' },
    })
  })
})
