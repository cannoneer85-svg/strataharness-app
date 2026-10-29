import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  resolveDesktopAutoUpdateConfig,
  resolveOptionalDesktopAutoUpdateConfig,
} from '../scripts/desktop-auto-update-environment.mjs'
import { validateDesktopPackageEnvironment } from '../scripts/desktop-package-environment.mjs'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'
import { resolveStrataSigningMode } from '../scripts/strata-signing-mode.mjs'
import * as windowsSign from '../scripts/windows-sign.mjs'

const WINDOWS_PFX_SECRETS: NodeJS.ProcessEnv = {
  WIN_CSC_LINK: 'C:\\temp\\strata-cert.pfx',
  WIN_CSC_KEY_PASSWORD: 'pfx-secret-password',
}

const WINDOWS_TOKEN_SECRETS: NodeJS.ProcessEnv = {
  DSH_DESKTOP_WINDOWS_CER_FILE: 'C:\\keys\\leaf.cer',
  DSH_DESKTOP_WINDOWS_SIGNTOOL: 'C:\\tools\\signtool.exe',
  DSH_DESKTOP_WINDOWS_KEY_CONTAINER: 'safenet-container',
  DSH_DESKTOP_WINDOWS_TOKEN_PIN: 'safenet-pin',
}

const MACOS_SIGNING_SECRETS: NodeJS.ProcessEnv = {
  CSC_LINK: '/tmp/developer-id.p12',
  CSC_KEY_PASSWORD: 'p12-export-password',
  DSH_DESKTOP_MACOS_SIGNING_IDENTITY: 'Strata Labs (TEAMID1234)',
  DSH_DESKTOP_MACOS_TEAM_ID: 'TEAMID1234',
}

const MACOS_API_KEY_NOTARY_SECRETS: NodeJS.ProcessEnv = {
  APPLE_API_KEY: '/tmp/AuthKey_TEST123456.p8',
  APPLE_API_KEY_ID: 'TEST123456',
  APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
}

describe('StrataHarness signing mode state machine and preflight validator', () => {
  it('defaults to auto and falls back cleanly to unsigned when platform secrets are absent or incomplete', () => {
    expect(resolveStrataSigningMode({ platform: 'win32', env: {} })).toEqual({
      requestedMode: 'auto',
      effectiveMode: 'unsigned',
      unsigned: true,
      signingMechanism: 'none',
      missingSecrets: ['WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD'],
    })

    expect(
      resolveStrataSigningMode({
        mode: 'auto',
        platform: 'win32',
        env: { WIN_CSC_LINK: 'C:\\temp\\strata-cert.pfx', WIN_CSC_KEY_PASSWORD: '   ' },
      }),
    ).toEqual({
      requestedMode: 'auto',
      effectiveMode: 'unsigned',
      unsigned: true,
      signingMechanism: 'none',
      missingSecrets: ['WIN_CSC_KEY_PASSWORD'],
    })

    expect(
      resolveStrataSigningMode({
        mode: 'auto',
        platform: 'darwin',
        env: { ...MACOS_SIGNING_SECRETS },
      }),
    ).toEqual({
      requestedMode: 'auto',
      effectiveMode: 'unsigned',
      unsigned: true,
      signingMechanism: 'none',
      missingSecrets: ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'],
    })
  })

  it('promotes auto mode to signed when complete Windows PFX, SafeNet token, or macOS credentials are present', () => {
    expect(resolveStrataSigningMode({ mode: 'auto', platform: 'win32', env: WINDOWS_PFX_SECRETS })).toEqual({
      requestedMode: 'auto',
      effectiveMode: 'signed',
      unsigned: false,
      signingMechanism: 'pfx',
      missingSecrets: [],
    })

    expect(resolveStrataSigningMode({ mode: 'auto', platform: 'win32', env: WINDOWS_TOKEN_SECRETS })).toEqual({
      requestedMode: 'auto',
      effectiveMode: 'signed',
      unsigned: false,
      signingMechanism: 'token',
      missingSecrets: [],
    })

    expect(
      resolveStrataSigningMode({
        mode: 'auto',
        platform: 'darwin',
        env: { ...MACOS_SIGNING_SECRETS, ...MACOS_API_KEY_NOTARY_SECRETS },
      }),
    ).toEqual({
      requestedMode: 'auto',
      effectiveMode: 'signed',
      unsigned: false,
      signingMechanism: 'apple',
      missingSecrets: [],
    })

    expect(
      resolveStrataSigningMode({
        mode: 'auto',
        platform: 'darwin',
        skipNotarization: true,
        env: MACOS_SIGNING_SECRETS,
      }),
    ).toEqual({
      requestedMode: 'auto',
      effectiveMode: 'signed',
      unsigned: false,
      signingMechanism: 'apple',
      missingSecrets: [],
    })

    expect(
      resolveStrataSigningMode({
        mode: 'auto',
        platform: 'darwin',
        env: {
          ...MACOS_SIGNING_SECRETS,
          APPLE_ID: 'release@strataharness.dev',
          APPLE_APP_SPECIFIC_PASSWORD: 'app-password',
          APPLE_TEAM_ID: 'TEAMID1234',
        },
      }),
    ).toMatchObject({ effectiveMode: 'signed', signingMechanism: 'apple' })

    expect(
      resolveStrataSigningMode({
        mode: 'auto',
        platform: 'darwin',
        env: { ...MACOS_SIGNING_SECRETS, APPLE_KEYCHAIN_PROFILE: 'strata-notary' },
      }),
    ).toMatchObject({ effectiveMode: 'signed', signingMechanism: 'apple' })
  })

  it('forces unsigned mode regardless of ambient platform secrets', () => {
    expect(
      resolveStrataSigningMode({
        mode: 'unsigned',
        platform: 'win32',
        env: WINDOWS_PFX_SECRETS,
      }),
    ).toEqual({
      requestedMode: 'unsigned',
      effectiveMode: 'unsigned',
      unsigned: true,
      signingMechanism: 'none',
      missingSecrets: [],
    })

    expect(
      resolveStrataSigningMode({
        platform: 'darwin',
        env: { ...MACOS_SIGNING_SECRETS, ...MACOS_API_KEY_NOTARY_SECRETS, STRATA_SIGNING_MODE: 'unsigned' },
      }),
    ).toMatchObject({ requestedMode: 'unsigned', effectiveMode: 'unsigned', unsigned: true })

    expect(
      resolveStrataSigningMode({
        platform: 'win32',
        env: { ...WINDOWS_PFX_SECRETS, DSH_DESKTOP_UNSIGNED: '1' },
      }),
    ).toMatchObject({ requestedMode: 'unsigned', effectiveMode: 'unsigned', unsigned: true })
  })

  it('fails fast on preflight with missing variable names when signed mode lacks complete secrets', () => {
    expect(() => resolveStrataSigningMode({ mode: 'signed', platform: 'win32', env: {} }))
      .toThrow(/WIN_CSC_LINK.*WIN_CSC_KEY_PASSWORD/u)

    expect(() =>
      resolveStrataSigningMode({
        mode: 'signed',
        platform: 'win32',
        env: { WIN_CSC_LINK: 'C:\\temp\\cert.pfx' },
      }),
    ).toThrow(/WIN_CSC_KEY_PASSWORD/u)

    expect(() =>
      resolveStrataSigningMode({
        mode: 'signed',
        platform: 'win32',
        env: { DSH_DESKTOP_WINDOWS_CER_FILE: 'C:\\keys\\leaf.cer', DSH_DESKTOP_WINDOWS_TOKEN_PIN: '1234' },
      }),
    ).toThrow(/DSH_DESKTOP_WINDOWS_SIGNTOOL.*DSH_DESKTOP_WINDOWS_KEY_CONTAINER/u)

    expect(() =>
      resolveStrataSigningMode({
        mode: 'signed',
        platform: 'darwin',
        env: { CSC_LINK: '/tmp/cert.p12', DSH_DESKTOP_MACOS_TEAM_ID: 'TEAMID1234' },
      }),
    ).toThrow(/CSC_KEY_PASSWORD.*DSH_DESKTOP_MACOS_SIGNING_IDENTITY.*APPLE_API_KEY/u)

    expect(() =>
      resolveStrataSigningMode({
        platform: 'darwin',
        env: { DSH_DESKTOP_UNSIGNED: '0', ...MACOS_SIGNING_SECRETS, APPLE_ID: 'dev@strataharness.dev' },
      }),
    ).toThrow(/APPLE_APP_SPECIFIC_PASSWORD.*APPLE_TEAM_ID/u)

    expect(() => resolveStrataSigningMode({ mode: 'invalid', platform: 'win32', env: {} }))
      .toThrow(/unsupported signing mode/u)
    expect(() => resolveStrataSigningMode({ mode: 'auto', platform: 'linux', env: {} }))
      .toThrow(/unsupported platform/u)
  })
})

describe('macOS unsigned dual-format targets and StrataHarness HTTPS update feed', () => {
  it.each(['arm64', 'x64'] as const)(
    'emits both dmg and zip with publish: null and -unsigned suffix for macOS %s unsigned and auto-fallback builds',
    (arch) => {
      const explicitUnsigned = createElectronBuilderConfig(
        {
          DSH_DESKTOP_APP_ID: 'com.nikl.strataharness',
          DSH_DESKTOP_TARGET_PLATFORM: 'darwin',
          DSH_DESKTOP_TARGET_ARCH: arch,
          DSH_DESKTOP_UNSIGNED: '1',
        },
        'darwin',
        arch,
      )

      expect(explicitUnsigned.mac.target).toEqual(['dmg', 'zip'])
      expect(explicitUnsigned.mac.identity).toBe('-')
      expect(explicitUnsigned.mac.forceCodeSigning).toBe(false)
      expect(explicitUnsigned.mac.notarize).toBe(false)
      expect(explicitUnsigned.publish).toBeNull()
      expect(explicitUnsigned.artifactName).toBe('strataharness-${version}-${os}-${arch}-unsigned.${ext}')

      const autoFallback = createElectronBuilderConfig(
        {
          DSH_DESKTOP_APP_ID: 'com.nikl.strataharness',
          DSH_DESKTOP_TARGET_PLATFORM: 'darwin',
          DSH_DESKTOP_TARGET_ARCH: arch,
          STRATA_SIGNING_MODE: 'auto',
        },
        'darwin',
        arch,
      )

      expect(autoFallback.mac.target).toEqual(['dmg', 'zip'])
      expect(autoFallback.publish).toBeNull()
      expect(autoFallback.artifactName).toBe('strataharness-${version}-${os}-${arch}-unsigned.${ext}')
    },
  )

  it('allows signed production builds without DOWNLOAD_PROD_ORIGIN (publish: null) and emits strataharness/feeds/<target>/ when configured', () => {
    const signedMacEnv: NodeJS.ProcessEnv = {
      DSH_DESKTOP_APP_ID: 'com.nikl.strataharness',
      DSH_DESKTOP_TARGET_PLATFORM: 'darwin',
      DSH_DESKTOP_TARGET_ARCH: 'arm64',
      DSH_DESKTOP_UNSIGNED: '0',
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
      DSH_DESKTOP_UPDATE_CHANNEL: 'latest',
      ...MACOS_SIGNING_SECRETS,
      ...MACOS_API_KEY_NOTARY_SECRETS,
    }

    expect(resolveOptionalDesktopAutoUpdateConfig(signedMacEnv, 'darwin', 'arm64')).toBeUndefined()
    expect(resolveOptionalDesktopAutoUpdateConfig({ ...signedMacEnv, DOWNLOAD_PROD_ORIGIN: '   ' }, 'darwin', 'arm64'))
      .toBeUndefined()

    const signedWithoutCdn = createElectronBuilderConfig(signedMacEnv, 'darwin', 'arm64')
    expect(signedWithoutCdn.publish).toBeNull()
    expect(signedWithoutCdn.mac.forceCodeSigning).toBe(true)
    expect(signedWithoutCdn.mac.notarize).toBe(true)
    expect(signedWithoutCdn.mac.target).toEqual(['dmg', 'zip'])
    expect(signedWithoutCdn.artifactName).toBe('strataharness-${version}-${os}-${arch}.${ext}')

    const signedWithCdn = createElectronBuilderConfig(
      {
        ...signedMacEnv,
        DOWNLOAD_PROD_ORIGIN: 'https://releases.strataharness.dev',
      },
      'darwin',
      'arm64',
    )
    expect(signedWithCdn.publish).toEqual([
      {
        provider: 'generic',
        url: 'https://releases.strataharness.dev/strataharness/feeds/mac-arm64/',
        channel: 'latest',
      },
    ])

    expect(
      resolveDesktopAutoUpdateConfig(
        {
          DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
          DSH_DESKTOP_UPDATE_CHANNEL: 'latest',
          DOWNLOAD_PROD_ORIGIN: 'https://releases.strataharness.dev',
        },
        'win32',
        'x64',
      ),
    ).toEqual({
      environment: 'production',
      channel: 'latest',
      target: 'win-x64',
      origin: 'https://releases.strataharness.dev',
      keyPrefix: 'strataharness/feeds/win-x64',
      binaryKeyPrefix: 'strataharness/bin/win-x64/latest',
      publicUrl: 'https://releases.strataharness.dev/strataharness/feeds/win-x64/',
    })

    for (const blockedOrigin of [
      'https://download.deepseek.com',
      'https://cdn.deepseek.com',
      'https://deepseek.com',
      'http://releases.strataharness.dev',
    ]) {
      expect(() =>
        createElectronBuilderConfig(
          { ...signedMacEnv, DOWNLOAD_PROD_ORIGIN: blockedOrigin },
          'darwin',
          'arm64',
        ),
      ).toThrow()
    }
  })
})

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(dir)
  return dir
}

function mkdirSyncSafe(dir: string): void {
  mkdirSync(dir, { recursive: true })
}

describe('Windows cloud .pfx signing adapter and RFC-3161 TSA fallback chain', () => {
  it('defines DigiCert, Sectigo, and GlobalSign RFC-3161 TSA servers and falls back sequentially with round retries', async () => {
    const tsaServers = Reflect.get(windowsSign, 'DEFAULT_WINDOWS_TSA_SERVERS') as readonly string[] | undefined
    const timestampWithFallback = Reflect.get(windowsSign, 'timestampWindowsArtifactWithFallback') as
      | ((
        path: string,
        options?: {
          signTool?: string
          tsaServers?: readonly string[]
          rounds?: number
          environment?: NodeJS.ProcessEnv
          execSignTool?: (
            file: string,
            args: readonly string[],
            options: { env: NodeJS.ProcessEnv; windowsHide: boolean; timeout: number },
          ) => Promise<{ stdout?: string; stderr?: string }>
          wait?: (delayMs: number) => Promise<void>
        },
      ) => Promise<{ server: string; round: number; attempts: number }>)
      | undefined

    expect(tsaServers).toEqual([
      'http://timestamp.digicert.com',
      'http://timestamp.sectigo.com',
      'http://timestamp.globalsign.com/tsa/r6advanced1',
    ])
    expect(timestampWithFallback).toBeTypeOf('function')

    const triedUrls: string[] = []
    const observedEnvs: NodeJS.ProcessEnv[] = []
    const firstFallbackResult = await timestampWithFallback!('C:\\build\\strataharness.exe', {
      signTool: 'C:\\sdk\\signtool.exe',
      environment: {
        PATH: 'C:\\Windows\\System32',
        WIN_CSC_KEY_PASSWORD: 'ultra-secret-password',
        DSH_DESKTOP_WINDOWS_TOKEN_PIN: 'safenet-secret',
      },
      execSignTool: async (_file, args, options) => {
        observedEnvs.push(options.env)
        const trIndex = args.indexOf('/tr')
        const url = args[trIndex + 1]!
        triedUrls.push(url)
        if (url !== 'http://timestamp.globalsign.com/tsa/r6advanced1') {
          throw Object.assign(new Error(`TSA unreachable: ${url}`), { code: 1 })
        }
        return { stdout: 'Successfully timestamped', stderr: '' }
      },
    })

    expect(firstFallbackResult).toEqual({
      server: 'http://timestamp.globalsign.com/tsa/r6advanced1',
      round: 1,
      attempts: 3,
    })
    expect(triedUrls).toEqual([
      'http://timestamp.digicert.com',
      'http://timestamp.sectigo.com',
      'http://timestamp.globalsign.com/tsa/r6advanced1',
    ])
    for (const env of observedEnvs) {
      expect(env).not.toHaveProperty('WIN_CSC_KEY_PASSWORD')
      expect(env).not.toHaveProperty('DSH_DESKTOP_WINDOWS_TOKEN_PIN')
    }

    const waitDelays: number[] = []
    let callCount = 0
    const retryRoundResult = await timestampWithFallback!('C:\\build\\strataharness.exe', {
      signTool: 'C:\\sdk\\signtool.exe',
      rounds: 2,
      wait: async (ms) => {
        waitDelays.push(ms)
      },
      execSignTool: async (_file, args) => {
        callCount += 1
        const url = args[args.indexOf('/tr') + 1]!
        if (callCount < 5) {
          throw Object.assign(new Error(`Transient HTTP 503 from ${url}`), { code: 1 })
        }
        return { stdout: 'Timestamped on round 2 Sectigo', stderr: '' }
      },
    })

    expect(retryRoundResult).toEqual({
      server: 'http://timestamp.sectigo.com',
      round: 2,
      attempts: 5,
    })
    expect(waitDelays).toEqual([1000])

    await expect(
      timestampWithFallback!('C:\\build\\strataharness.exe', {
        signTool: 'C:\\sdk\\signtool.exe',
        rounds: 2,
        wait: async () => {},
        execSignTool: async () => {
          throw Object.assign(new Error('All TSAs offline'), { code: 1 })
        },
      }),
    ).rejects.toThrow(/timestamp\.digicert\.com.*timestamp\.sectigo\.com.*timestamp\.globalsign\.com/u)
  })

  it('signs with file-backed and Base64 .pfx certificates, falls back across TSAs without re-signing, cleans RUNNER_TEMP, and redacts passwords on failure', async () => {
    const createWindowsPfxSigner = Reflect.get(windowsSign, 'createWindowsPfxSigner') as
      | ((options: {
        pfxLink?: string
        pfxPassword?: string
        signTool?: string
        tsaServers?: readonly string[]
        tsaRounds?: number
        tempDirectory?: string
        environment?: NodeJS.ProcessEnv
        preserveSignature?: (path: string) => Promise<boolean>
        execSignTool?: (
          file: string,
          args: readonly string[],
          options: { env: NodeJS.ProcessEnv; windowsHide: boolean; timeout: number },
        ) => Promise<{ stdout?: string; stderr?: string }>
        wait?: (delayMs: number) => Promise<void>
      }) => (configuration: { path: string; hash: string; isNest: boolean }) => Promise<void>)
      | undefined

    expect(createWindowsPfxSigner).toBeTypeOf('function')

    const fixtureRoot = makeTempDir('strata-pfx-test-')
    const pfxFile = join(fixtureRoot, 'release-cert.pfx')
    const pfxPayload = Buffer.from('pkcs12-binary-fixture-payload-0123456789', 'utf8')
    writeFileSync(pfxFile, pfxPayload)

    const fileCommands: string[][] = []
    const fileSigner = createWindowsPfxSigner!({
      pfxLink: pfxFile,
      pfxPassword: 'SuperSecretPfxPassword!42',
      signTool: 'C:\\sdk\\signtool.exe',
      execSignTool: async (_file, args) => {
        fileCommands.push([...args])
        if (args[0] === 'timestamp' && args.includes('http://timestamp.digicert.com')) {
          throw Object.assign(new Error('DigiCert timeout'), { code: 1 })
        }
        return { stdout: '', stderr: '' }
      },
    })

    await fileSigner({ path: 'C:\\dist\\strataharness-1.0.0-win-x64.exe', hash: 'sha256', isNest: false })
    expect(fileCommands).toHaveLength(3)
    expect(fileCommands[0]).toEqual([
      'sign',
      '/v',
      '/fd',
      'sha256',
      '/f',
      expect.stringContaining('release-cert.pfx'),
      '/p',
      'SuperSecretPfxPassword!42',
      'C:\\dist\\strataharness-1.0.0-win-x64.exe',
    ])
    expect(fileCommands[1]).toEqual([
      'timestamp',
      '/v',
      '/tr',
      'http://timestamp.digicert.com',
      '/td',
      'sha256',
      'C:\\dist\\strataharness-1.0.0-win-x64.exe',
    ])
    expect(fileCommands[2]).toEqual([
      'timestamp',
      '/v',
      '/tr',
      'http://timestamp.sectigo.com',
      '/td',
      'sha256',
      'C:\\dist\\strataharness-1.0.0-win-x64.exe',
    ])

    const runnerTemp = makeTempDir('strata-runner-temp-')
    let materializedBytesDuringSign: Buffer | undefined
    let materializedPathDuringSign: string | undefined
    const base64Signer = createWindowsPfxSigner!({
      pfxLink: pfxPayload.toString('base64'),
      pfxPassword: 'Base64SecretPassword!99',
      signTool: 'C:\\sdk\\signtool.exe',
      environment: { RUNNER_TEMP: runnerTemp },
      execSignTool: async (_file, args) => {
        if (args[0] === 'sign') {
          const fIndex = args.indexOf('/f')
          materializedPathDuringSign = args[fIndex + 1]
          materializedBytesDuringSign = readFileSync(materializedPathDuringSign!)
        }
        return { stdout: '', stderr: '' }
      },
    })

    await base64Signer({ path: 'C:\\dist\\nested.exe', hash: 'sha256', isNest: true })
    expect(materializedPathDuringSign).toBeDefined()
    expect(materializedPathDuringSign!.startsWith(runnerTemp)).toBe(true)
    expect(materializedBytesDuringSign).toEqual(pfxPayload)
    expect(existsSync(materializedPathDuringSign!)).toBe(false)
    expect(readdirSync(runnerTemp)).toEqual([])

    const failingBase64Signer = createWindowsPfxSigner!({
      pfxLink: `data:application/x-pkcs12;base64,${pfxPayload.toString('base64')}`,
      pfxPassword: 'NeverLeakThisPassword#777',
      signTool: 'C:\\sdk\\signtool.exe',
      tempDirectory: runnerTemp,
      execSignTool: async () => {
        throw Object.assign(new Error('SignTool failed with NeverLeakThisPassword#777'), {
          code: 1,
          stderr: 'Invalid password NeverLeakThisPassword#777 for archive',
        })
      },
    })

    let caughtError: Error | undefined
    try {
      await failingBase64Signer({ path: 'C:\\dist\\broken.exe', hash: 'sha256', isNest: false })
    } catch (error) {
      caughtError = error as Error
    }
    expect(caughtError).toBeInstanceOf(Error)
    expect(caughtError!.message).toContain('<redacted>')
    expect(caughtError!.message).not.toContain('NeverLeakThisPassword#777')
    expect(caughtError!.cause).toBeUndefined()
    expect(readdirSync(runnerTemp)).toEqual([])

    const preserved = vi.fn(async () => true)
    const execSpy = vi.fn(async () => ({ stdout: '', stderr: '' }))
    const preservingSigner = createWindowsPfxSigner!({
      pfxLink: pfxFile,
      pfxPassword: 'ValidPassword123',
      signTool: 'C:\\sdk\\signtool.exe',
      preserveSignature: preserved,
      execSignTool: execSpy,
    })
    await preservingSigner({ path: 'C:\\dist\\cached-node.exe', hash: 'sha256', isNest: false })
    expect(preserved).toHaveBeenCalledOnce()
    expect(execSpy).not.toHaveBeenCalled()

    expect(() => createWindowsPfxSigner!({ pfxLink: '', pfxPassword: 'secret' })).toThrow(/WIN_CSC_LINK/u)
    expect(() => createWindowsPfxSigner!({ pfxLink: join(fixtureRoot, 'missing.pfx'), pfxPassword: 'secret' }))
      .toThrow(/WIN_CSC_LINK/u)
    expect(() => createWindowsPfxSigner!({ pfxLink: pfxFile, pfxPassword: '   ' })).toThrow(/WIN_CSC_KEY_PASSWORD/u)
  })

  it('wires Windows .pfx signing into createElectronBuilderConfig and validateDesktopPackageEnvironment', () => {
    const fixtureRoot = makeTempDir('strata-eb-pfx-')
    const pfxPayload = Buffer.from('pkcs12-electron-builder-fixture', 'utf8')
    const signedWinEnv: NodeJS.ProcessEnv = {
      DSH_DESKTOP_APP_ID: 'com.nikl.strataharness',
      DSH_DESKTOP_TARGET_PLATFORM: 'win32',
      DSH_DESKTOP_TARGET_ARCH: 'x64',
      STRATA_SIGNING_MODE: 'signed',
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
      DSH_DESKTOP_UPDATE_CHANNEL: 'latest',
      WIN_CSC_LINK: pfxPayload.toString('base64'),
      WIN_CSC_KEY_PASSWORD: 'ci-pfx-password',
      DSH_DESKTOP_WINDOWS_SIGNATURE_CACHE_DIR: join(fixtureRoot, 'sig-cache'),
    }

    expect(() => {
      validateDesktopPackageEnvironment(
        signedWinEnv,
        { platform: 'win32', arch: 'x64' },
        { unsigned: false },
      )
    }).not.toThrow()

    const configWithoutFeed = createElectronBuilderConfig(signedWinEnv, 'win32', 'x64')
    expect(configWithoutFeed.win.forceCodeSigning).toBe(true)
    expect(configWithoutFeed.win.signtoolOptions.sign).toBeTypeOf('function')
    expect(configWithoutFeed.win.signtoolOptions.publisherName).toBeUndefined()
    expect(configWithoutFeed.publish).toBeNull()
    expect(configWithoutFeed.artifactName).toBe('strataharness-${version}-${os}-${arch}.${ext}')

    const configWithFeed = createElectronBuilderConfig(
      {
        ...signedWinEnv,
        DOWNLOAD_PROD_ORIGIN: 'https://cdn.strataharness.dev',
        DSH_DESKTOP_WINDOWS_PUBLISHER_NAME: 'Strata Labs LLC',
      },
      'win32',
      'x64',
    )
    expect(configWithFeed.win.signtoolOptions.publisherName).toBe('Strata Labs LLC')
    expect(configWithFeed.publish).toEqual([
      {
        provider: 'generic',
        url: 'https://cdn.strataharness.dev/strataharness/feeds/win-x64/',
        channel: 'latest',
      },
    ])

    const sdkRoot = join(fixtureRoot, 'ProgramFilesX86')
    const olderSdkDir = join(sdkRoot, 'Windows Kits', '10', 'bin', '10.0.19041.0', 'x64')
    const newerSdkDir = join(sdkRoot, 'Windows Kits', '10', 'bin', '10.0.26100.0', 'x64')
    rmSync(sdkRoot, { recursive: true, force: true })
    writeFileSync(join(makeTempDir('strata-sdk-placeholder-'), 'noop'), '')
    mkdirSyncSafe(olderSdkDir)
    mkdirSyncSafe(newerSdkDir)
    const olderSignTool = join(olderSdkDir, 'signtool.exe')
    const newerSignTool = join(newerSdkDir, 'signtool.exe')
    writeFileSync(olderSignTool, 'stub-exe')
    writeFileSync(newerSignTool, 'stub-exe')

    expect(
      windowsSign.resolveWindowsPfxSignTool(undefined, {
        'ProgramFiles(x86)': sdkRoot,
        ProgramFiles: join(fixtureRoot, 'EmptyProgramFiles'),
        PATH: '',
      }),
    ).toContain('10.0.26100.0')

    expect(() =>
      windowsSign.resolveWindowsPfxSignTool(undefined, {
        'ProgramFiles(x86)': join(fixtureRoot, 'EmptyProgramFilesX86'),
        ProgramFiles: join(fixtureRoot, 'EmptyProgramFiles'),
        PATH: '',
      }),
    ).toThrow(/could not locate signtool\.exe/u)

    expect(
      windowsSign.createWindowsReleaseSigner({
        environment: signedWinEnv,
      }),
    ).toBeTypeOf('function')

    expect(() =>
      windowsSign.createWindowsReleaseSigner({
        environment: {},
      }),
    ).toThrow(/DSH_DESKTOP_WINDOWS_CER_FILE/u)
  }, 30_000)
})
