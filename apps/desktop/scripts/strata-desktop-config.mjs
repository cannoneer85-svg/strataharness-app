/** Centralized StrataHarness desktop identity, protocol, update, and resource configuration. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'semver'

const DEFAULT_REPOSITORY_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** Root manifest filename declaring StrataHarness dual-track product version metadata. */
export const STRATA_PRODUCT_MANIFEST_FILENAME = 'strata-product.json'

/** Environment variable overriding `productVersion` during local updater qualification runs. */
export const STRATA_PRODUCT_VERSION_ENV = 'STRATA_PRODUCT_VERSION'

/** Shipped desktop product name across Electron menus, dialogs, bundles, and installers. */
export const STRATA_DESKTOP_PRODUCT_NAME = 'StrataHarness'

/** Packaged manifest name isolating Electron userData and single-instance lock from `@deepseek-ai/dsh-desktop`. */
export const STRATA_DESKTOP_PACKAGE_NAME = '@strata/desktop'

/** Reverse-DNS application identifier shared by Windows and macOS targets. */
export const STRATA_DESKTOP_APP_ID = 'com.nikl.strataharness'

/** External deep-link URL protocol scheme registered with the operating system. */
export const STRATA_DESKTOP_URL_SCHEME = 'strata'

/** Filename prefix emitted for packaged desktop installers and archives. */
export const STRATA_DESKTOP_ARTIFACT_PREFIX = 'strataharness'

/** Path prefix used for static HTTPS auto-update feeds and binary objects. */
export const STRATA_UPDATE_RELEASE_PREFIX = 'strataharness'

/** Custom URL protocol registration passed to electron-builder. */
export const STRATA_DESKTOP_PROTOCOLS = Object.freeze([
  Object.freeze({
    name: STRATA_DESKTOP_PRODUCT_NAME,
    schemes: Object.freeze([STRATA_DESKTOP_URL_SCHEME]),
  }),
])

/** macOS microphone usage prompt written to Info.plist. */
export const STRATA_MACOS_MICROPHONE_USAGE =
  'StrataHarness uses your microphone to transcribe speech into message drafts.'

/** NSIS installer language identifiers compiled into the Windows installer. */
export const STRATA_NSIS_INSTALLER_LANGUAGES = Object.freeze(['ru_RU', 'en_US', 'zh_CN'])

/** Environment variable supplying the production auto-update origin when self-hosted updates are enabled. */
export const STRATA_PRODUCTION_UPDATE_ORIGIN_ENV = 'DOWNLOAD_PROD_ORIGIN'

/** Production fixed auto-update origin; undefined disables upstream DeepSeek CDN fallback. */
export const STRATA_PRODUCTION_UPDATE_FIXED_ORIGIN = undefined

const BLOCKED_UPSTREAM_APP_IDS = new Set(['com.deepseek.harness'])
const BLOCKED_UPSTREAM_UPDATE_ORIGINS = new Set(['https://download.deepseek.com'])

/**
 * Format the electron-builder artifact filename template with an optional qualification suffix.
 * @param {string} [suffix] - Qualification suffix such as `-unsigned` or `-unnotarized`.
 * @returns {string} electron-builder `artifactName` template.
 */
export function strataArtifactNameTemplate(suffix = '') {
  return `${STRATA_DESKTOP_ARTIFACT_PREFIX}-\${version}-\${os}-\${arch}${suffix}.\${ext}`
}

/**
 * Format the concrete base filename (`strataharness-<version>-<os>-<arch>`) for a built target.
 * @param {string} version - Published build version.
 * @param {string} target - Platform-arch suffix such as `win-x64` or `mac-arm64`.
 * @returns {string} Artifact base name without extension.
 */
export function strataArtifactBaseName(version, target) {
  return `${STRATA_DESKTOP_ARTIFACT_PREFIX}-${version}-${target}`
}

/**
 * Reject upstream DeepSeek production application identifiers.
 * @param {string} appId - Candidate reverse-DNS application identifier.
 * @returns {string} Validated application identifier.
 */
export function assertIsolatedStrataAppId(appId) {
  if (BLOCKED_UPSTREAM_APP_IDS.has(appId)) {
    throw new Error(`desktop release environment: DSH_DESKTOP_APP_ID must not use upstream identifier ${appId}`)
  }
  return appId
}

/**
 * Reject upstream DeepSeek CDN update origins so packaged builds never contact download.deepseek.com or production *.deepseek.com endpoints.
 * @param {URL} url - Parsed HTTPS origin.
 * @param {string} settingName - Environment or config field name for diagnostics.
 * @returns {string} Validated HTTPS origin string.
 */
export function assertIsolatedStrataUpdateOrigin(url, settingName) {
  const host = url.hostname.toLowerCase()
  const blocksSubdomains = settingName === STRATA_PRODUCTION_UPDATE_ORIGIN_ENV
  if (
    BLOCKED_UPSTREAM_UPDATE_ORIGINS.has(url.origin)
    || host === 'deepseek.com'
    || (blocksSubdomains && host.endsWith('.deepseek.com'))
  ) {
    throw new Error(`desktop auto-update: ${settingName} must not target upstream origin ${url.origin}`)
  }
  return url.origin
}

/**
 * Reject upstream DeepSeek mandatory-update policy servers.
 * @param {URL} url - Parsed HTTPS origin.
 * @param {string} settingName - Environment or config field name for diagnostics.
 * @returns {string} Validated HTTPS origin string.
 */
export function assertIsolatedStrataPolicyOrigin(url, settingName) {
  const host = url.hostname.toLowerCase()
  if (host === 'deepseek.com' || host.endsWith('.deepseek.com')) {
    throw new Error(`desktop package: ${settingName} must not target a DeepSeek policy domain`)
  }
  return url.origin
}

/**
 * Return extraResources mappings that bundle the StrataHarness methodology and designer skills outside app.asar.
 * @param {string} repositoryRoot - Monorepo root directory.
 * @returns {Array<{ from: string, to: string, filter: string[] }>} electron-builder extraResources entries.
 */
export function strataBundledExtraResources(repositoryRoot) {
  return [
    {
      from: join(repositoryRoot, 'resources', 'strataharness'),
      to: 'strataharness',
      filter: ['**/*', '!.git', '!.git/**', '!**/__pycache__/**', '!**/*.pyc'],
    },
    {
      from: join(repositoryRoot, 'packages', 'strata', 'product-bundle', 'skills', 'designer'),
      to: 'strata-skills/designer',
      filter: ['**/*'],
    },
  ]
}

/**
 * Validate a strict canonical SemVer version without build metadata.
 * @param {unknown} value - Candidate version string.
 * @param {string} label - Field or variable name used in diagnostics.
 * @returns {string} Canonical SemVer string.
 */
function validateStrataSemVer(value, label) {
  if (typeof value !== 'string') {
    throw new Error(`strata product manifest: ${label} must be a SemVer string`)
  }
  const parsed = parse(value, { loose: false })
  if (parsed === null || parsed.version !== value) {
    throw new Error(`strata product manifest: ${label} ${JSON.stringify(value)} is not a valid SemVer version`)
  }
  if (parsed.build.length > 0) {
    throw new Error(`strata product manifest: ${label} ${value} cannot carry build metadata`)
  }
  return parsed.version
}

/**
 * Read and validate the root `strata-product.json` manifest.
 * @param {string} [repositoryRoot] - Monorepo root directory containing `strata-product.json`.
 * @returns {{ productName: string, productVersion: string, upstreamBaseTag: string, upstreamRepository: string }} Validated product manifest.
 */
export function readStrataProductManifest(repositoryRoot = DEFAULT_REPOSITORY_ROOT) {
  const manifestPath = join(repositoryRoot, STRATA_PRODUCT_MANIFEST_FILENAME)
  let raw
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8'))
  }
  catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`strata product manifest: cannot read ${manifestPath}: ${detail}`)
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`strata product manifest: ${manifestPath} must contain a JSON object`)
  }
  if (typeof raw.productName !== 'string' || raw.productName.trim() === '') {
    throw new Error('strata product manifest: productName must be a non-empty string')
  }
  const productVersion = validateStrataSemVer(raw.productVersion, 'productVersion')
  if (typeof raw.upstreamBaseTag !== 'string' || !raw.upstreamBaseTag.startsWith('dsh-v')) {
    throw new Error(`strata product manifest: upstreamBaseTag ${JSON.stringify(raw.upstreamBaseTag)} must start with "dsh-v"`)
  }
  validateStrataSemVer(raw.upstreamBaseTag.slice('dsh-v'.length), 'upstreamBaseTag')
  if (typeof raw.upstreamRepository !== 'string' || raw.upstreamRepository.trim() === '') {
    throw new Error('strata product manifest: upstreamRepository must be a non-empty string')
  }
  return {
    productName: raw.productName,
    productVersion,
    upstreamBaseTag: raw.upstreamBaseTag,
    upstreamRepository: raw.upstreamRepository,
  }
}

/**
 * Resolve the StrataHarness product SemVer for packaging, installers, and local updater qualification.
 * @param {NodeJS.ProcessEnv} [env] - Environment that may define `STRATA_PRODUCT_VERSION`.
 * @param {string} [repositoryRoot] - Monorepo root directory containing `strata-product.json`.
 * @returns {string} Validated StrataHarness product SemVer string.
 */
export function resolveStrataProductVersion(env = process.env, repositoryRoot = DEFAULT_REPOSITORY_ROOT) {
  const override = env[STRATA_PRODUCT_VERSION_ENV]?.trim()
  if (override !== undefined && override !== '') {
    return validateStrataSemVer(override, STRATA_PRODUCT_VERSION_ENV)
  }
  return readStrataProductManifest(repositoryRoot).productVersion
}
