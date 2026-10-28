/** Centralized StrataHarness desktop identity, protocol, update, and resource configuration. */

import { join } from 'node:path'

/** Shipped desktop product name across Electron menus, dialogs, bundles, and installers. */
export const STRATA_DESKTOP_PRODUCT_NAME = 'StrataHarness'

/** Reverse-DNS application identifier shared by Windows and macOS targets. */
export const STRATA_DESKTOP_APP_ID = 'com.nikl.strataharness'

/** External deep-link URL protocol scheme registered with the operating system. */
export const STRATA_DESKTOP_URL_SCHEME = 'strata'

/** Filename prefix emitted for packaged desktop installers and archives. */
export const STRATA_DESKTOP_ARTIFACT_PREFIX = 'strataharness'

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
export const STRATA_NSIS_INSTALLER_LANGUAGES = Object.freeze(['en_US', 'ru_RU', 'zh_CN'])

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
 * Reject upstream DeepSeek CDN update origins so packaged builds never contact download.deepseek.com.
 * @param {URL} url - Parsed HTTPS origin.
 * @param {string} settingName - Environment or config field name for diagnostics.
 * @returns {string} Validated HTTPS origin string.
 */
export function assertIsolatedStrataUpdateOrigin(url, settingName) {
  if (BLOCKED_UPSTREAM_UPDATE_ORIGINS.has(url.origin)) {
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
