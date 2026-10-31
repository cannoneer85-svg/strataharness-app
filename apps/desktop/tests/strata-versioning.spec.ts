import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDesktopUploadPlan } from '../scripts/desktop-upload-plan.ts'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'
import * as strataDesktopConfig from '../scripts/strata-desktop-config.mjs'
import * as desktopLocale from '../src/locale.ts'
import * as desktopUpdateChannelModule from '../src/update-channel.ts'

const require = createRequire(import.meta.url)
const { createBlockmap } = require('app-builder-lib/out/targets/differentialUpdateInfoBuilder.js') as {
  createBlockmap: (
    file: string,
    target: object,
    packager: { info: { emitArtifactBuildCompleted(event: object): Promise<void> } },
    safeArtifactName: string,
  ) => Promise<{ size: number; sha512: string }>
}

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..', '..', '..')
const APP_ROOT = resolve(import.meta.dirname, '..')
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createManifestFixture(manifest: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'strata-product-manifest-'))
  temporaryDirectories.push(root)
  writeFileSync(join(root, 'strata-product.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return root
}

describe('StrataHarness dual-track product manifest and SemVer resolution', () => {
  it('declares independent product version 1.0.0 in strata-product.json and @strata/* while keeping DSH engine manifests at 0.2.1-rc.4', () => {
    const { readStrataProductManifest } = strataDesktopConfig
    expect(readStrataProductManifest).toBeTypeOf('function')

    const productManifest = readStrataProductManifest(REPOSITORY_ROOT)
    expect(productManifest).toEqual({
      productName: 'StrataHarness',
      productVersion: '1.0.0',
      upstreamBaseTag: 'dsh-v0.2.1-rc.4',
      upstreamRepository: 'https://github.com/deepseek-ai/deepseek-harness.git',
    })

    const localeRu = JSON.parse(
      readFileSync(join(REPOSITORY_ROOT, 'packages', 'strata', 'locale-ru', 'package.json'), 'utf8'),
    ) as { version: string }
    const productBundle = JSON.parse(
      readFileSync(join(REPOSITORY_ROOT, 'packages', 'strata', 'product-bundle', 'package.json'), 'utf8'),
    ) as { version: string }
    const uiBrand = JSON.parse(
      readFileSync(join(REPOSITORY_ROOT, 'packages', 'strata', 'ui-brand', 'package.json'), 'utf8'),
    ) as { version: string }
    expect(localeRu.version).toBe('1.0.0')
    expect(productBundle.version).toBe('1.0.0')
    expect(uiBrand.version).toBe('1.0.0')

    const rootPackage = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'package.json'), 'utf8')) as { version: string }
    const desktopPackage = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as { version: string }
    expect(rootPackage.version).toBe('0.2.1-rc.4')
    expect(desktopPackage.version).toBe('0.2.1-rc.4')
  })

  it('resolves productVersion from strata-product.json, supports trimmed STRATA_PRODUCT_VERSION overrides, and rejects invalid SemVer', () => {
    const { readStrataProductManifest, resolveStrataProductVersion } = strataDesktopConfig
    expect(resolveStrataProductVersion).toBeTypeOf('function')
    expect(readStrataProductManifest).toBeTypeOf('function')

    expect(resolveStrataProductVersion({}, REPOSITORY_ROOT)).toBe('1.0.0')
    expect(resolveStrataProductVersion({ STRATA_PRODUCT_VERSION: '   ' }, REPOSITORY_ROOT)).toBe('1.0.0')
    expect(resolveStrataProductVersion({ STRATA_PRODUCT_VERSION: ' 1.0.1 ' }, REPOSITORY_ROOT)).toBe('1.0.1')
    expect(resolveStrataProductVersion({ STRATA_PRODUCT_VERSION: '1.1.0-rc.1' }, REPOSITORY_ROOT)).toBe('1.1.0-rc.1')

    for (const invalid of ['v1.0.0', '1.0', '01.0.0', '1.0.0+build.1', 'not-a-version']) {
      expect(() => resolveStrataProductVersion({ STRATA_PRODUCT_VERSION: invalid }, REPOSITORY_ROOT)).toThrow(/SemVer|build metadata/iu)
      const invalidRoot = createManifestFixture({
        productName: 'StrataHarness',
        productVersion: invalid,
        upstreamBaseTag: 'dsh-v0.2.1-rc.4',
        upstreamRepository: 'https://github.com/deepseek-ai/deepseek-harness.git',
      })
      expect(() => readStrataProductManifest(invalidRoot)).toThrow(/SemVer|build metadata/iu)
    }

    const badTagRoot = createManifestFixture({
      productName: 'StrataHarness',
      productVersion: '1.0.0',
      upstreamBaseTag: 'v0.2.1-rc.4',
      upstreamRepository: 'https://github.com/deepseek-ai/deepseek-harness.git',
    })
    expect(() => readStrataProductManifest(badTagRoot)).toThrow(/upstreamBaseTag/u)
  })

  it('wires productVersion 1.0.0 and dshEngineVersion 0.2.1-rc.4 into electron-builder extraMetadata without mutating apps/desktop/package.json', () => {
    const baseEnv: NodeJS.ProcessEnv = {
      DSH_DESKTOP_APP_ID: 'com.nikl.strataharness',
      DSH_DESKTOP_TARGET_PLATFORM: 'win32',
      DSH_DESKTOP_TARGET_ARCH: 'x64',
      DSH_DESKTOP_UNSIGNED: '1',
    }

    const defaultConfig = createElectronBuilderConfig(baseEnv, 'win32', 'x64')
    expect(defaultConfig.extraMetadata).toMatchObject({
      name: '@strata/desktop',
      version: '1.0.0',
      dshEngineVersion: '0.2.1-rc.4',
    })
    expect(defaultConfig.artifactName).toBe('strataharness-${version}-${os}-${arch}-unsigned.${ext}')

    const overrideConfig = createElectronBuilderConfig(
      { ...baseEnv, STRATA_PRODUCT_VERSION: '1.0.1' },
      'win32',
      'x64',
    )
    expect(overrideConfig.extraMetadata).toMatchObject({
      version: '1.0.1',
      dshEngineVersion: '0.2.1-rc.4',
    })

    const buildVersionConfig = createElectronBuilderConfig(
      { ...baseEnv, DSH_DESKTOP_BUILD_VERSION: '1.0.0-test.20261029.1' },
      'win32',
      'x64',
    )
    expect(buildVersionConfig.extraMetadata).toMatchObject({
      version: '1.0.0-test.20261029.1',
      dshEngineVersion: '0.2.1-rc.4',
    })

    const desktopPackage = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as { version: string }
    expect(desktopPackage.version).toBe('0.2.1-rc.4')
  }, 30_000)

  it('validates upload plans against strata-product.json productVersion when workspace package.json holds the DSH engine version', async () => {
    const root = mkdtempSync(join(tmpdir(), 'strata-dual-upload-'))
    temporaryDirectories.push(root)
    const repositoryRoot = join(root, 'repo')
    const appRoot = join(repositoryRoot, 'apps', 'desktop')
    const artifactsRoot = join(appRoot, '.desktop-build', 'artifacts')
    mkdirSync(artifactsRoot, { recursive: true })

    writeFileSync(join(repositoryRoot, 'package.json'), '{"version":"0.2.1-rc.4"}\n')
    writeFileSync(join(appRoot, 'package.json'), '{"version":"0.2.1-rc.4"}\n')
    writeFileSync(
      join(repositoryRoot, 'strata-product.json'),
      `${JSON.stringify({
        productName: 'StrataHarness',
        productVersion: '1.0.0',
        upstreamBaseTag: 'dsh-v0.2.1-rc.4',
        upstreamRepository: 'https://github.com/deepseek-ai/deepseek-harness.git',
      }, null, 2)}\n`,
    )

    const exeName = 'strataharness-1.0.0-win-x64.exe'
    const exeContents = 'signed dual-track NSIS fixture'
    const exePath = join(artifactsRoot, exeName)
    writeFileSync(exePath, exeContents)
    const blockmapInfo = await createBlockmap(
      exePath,
      {},
      { info: { emitArtifactBuildCompleted: async () => {} } },
      exeName,
    )
    const sha512 = createHash('sha512').update(exeContents).digest('base64')
    expect(blockmapInfo.sha512).toBe(sha512)

    writeFileSync(
      join(artifactsRoot, 'win-x64-release.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        channel: 'latest',
        target: 'win-x64',
        version: '1.0.0',
        environment: 'production',
        publicUrl: 'https://updates.example.com/strataharness/feeds/win-x64/',
      })}\n`,
    )
    writeFileSync(
      join(artifactsRoot, 'latest.yml'),
      `${JSON.stringify({
        version: '1.0.0',
        path: exeName,
        files: [{ url: exeName, ...blockmapInfo }],
      })}\n`,
    )

    const environment: NodeJS.ProcessEnv = {
      DSH_DESKTOP_UPDATE_CHANNEL: 'latest',
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
      DOWNLOAD_PROD_ORIGIN: 'https://updates.example.com',
      DOWNLOAD_PROD_COS_BUCKET: 'strata-updates-1250000000',
    }

    const plan = await createDesktopUploadPlan('win-x64', {
      repositoryRoot,
      appRoot,
      artifactsRoot,
      environment,
    })
    expect(plan.version).toBe('1.0.0')

    await expect(
      createDesktopUploadPlan('win-x64', {
        repositoryRoot,
        appRoot,
        artifactsRoot,
        environment: { ...environment, STRATA_PRODUCT_VERSION: '1.0.1' },
      }),
    ).rejects.toThrow(/1\.0\.1/u)
  })

  it('extracts dshEngineVersion from the packaged manifest and formats localized About StrataHarness copy with both product and engine versions', () => {
    const desktopEngineVersion = Reflect.get(desktopUpdateChannelModule, 'desktopEngineVersion') as
      | ((manifest: unknown) => string | undefined)
      | undefined
    const formatDesktopAboutDetail = Reflect.get(desktopLocale, 'formatDesktopAboutDetail') as
      | ((messages: desktopLocale.DesktopMessages, productVersion: string, engineVersion?: string) => string)
      | undefined
    expect(desktopEngineVersion).toBeTypeOf('function')
    expect(formatDesktopAboutDetail).toBeTypeOf('function')

    expect(desktopEngineVersion!({ version: '1.0.0', dshEngineVersion: '0.2.1-rc.4' })).toBe('0.2.1-rc.4')
    expect(desktopEngineVersion!({ version: '0.2.1-rc.4' })).toBe('0.2.1-rc.4')
    expect(desktopEngineVersion!({ dshDesktopAppId: 'com.nikl.strataharness' })).toBeUndefined()
    expect(() => desktopEngineVersion!(null)).toThrow(/manifest/u)
    expect(() => desktopEngineVersion!({ version: '1.0.0', dshEngineVersion: '' })).toThrow(/dshEngineVersion/u)

    expect(formatDesktopAboutDetail!(desktopLocale.ru, '1.0.0', '0.2.1-rc.4')).toBe(
      'Версия V1.0.0\nДвижок: DSH 0.2.1-rc.4',
    )
    expect(formatDesktopAboutDetail!(desktopLocale.en, '1.0.0', '0.2.1-rc.4')).toBe(
      'Version V1.0.0\nEngine: DSH 0.2.1-rc.4',
    )
    expect(formatDesktopAboutDetail!(desktopLocale.zh, '1.0.0', '0.2.1-rc.4')).toBe(
      '版本 V1.0.0\n引擎：DSH 0.2.1-rc.4',
    )
    expect(formatDesktopAboutDetail!(desktopLocale.ru, '1.0.0')).toBe('Версия V1.0.0')
    expect(formatDesktopAboutDetail!(desktopLocale.en, '1.0.0')).toBe('Version V1.0.0')
    expect(formatDesktopAboutDetail!(desktopLocale.zh, '1.0.0', '')).toBe('版本 V1.0.0')
  })
})
