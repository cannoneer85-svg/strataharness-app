/** Centralized StrataHarness desktop identity, protocol, update, and resource configuration. */

/** Root manifest filename declaring StrataHarness dual-track product version metadata. */
export const STRATA_PRODUCT_MANIFEST_FILENAME: 'strata-product.json'

/** Environment variable overriding `productVersion` during local updater qualification runs. */
export const STRATA_PRODUCT_VERSION_ENV: 'STRATA_PRODUCT_VERSION'

/** Validated root `strata-product.json` manifest fields. */
export interface StrataProductManifest {
  readonly productName: string
  readonly productVersion: string
  readonly upstreamBaseTag: string
  readonly upstreamRepository: string
}

/** Shipped desktop product name across Electron menus, dialogs, bundles, and installers. */
export const STRATA_DESKTOP_PRODUCT_NAME: 'StrataHarness'

/** Packaged manifest name isolating Electron userData and single-instance lock from `@deepseek-ai/dsh-desktop`. */
export const STRATA_DESKTOP_PACKAGE_NAME: '@strata/desktop'

/** Reverse-DNS application identifier shared by Windows and macOS targets. */
export const STRATA_DESKTOP_APP_ID: 'com.nikl.strataharness'

/** External deep-link URL protocol scheme registered with the operating system. */
export const STRATA_DESKTOP_URL_SCHEME: 'strata'

/** Filename prefix emitted for packaged desktop installers and archives. */
export const STRATA_DESKTOP_ARTIFACT_PREFIX: 'strataharness'

/** Path prefix used for static HTTPS auto-update feeds and binary objects. */
export const STRATA_UPDATE_RELEASE_PREFIX: 'strataharness'

/** Custom URL protocol registration passed to electron-builder. */
export const STRATA_DESKTOP_PROTOCOLS: readonly [{
  readonly name: 'StrataHarness'
  readonly schemes: readonly ['strata']
}]

/** macOS microphone usage prompt written to Info.plist. */
export const STRATA_MACOS_MICROPHONE_USAGE: string

/** NSIS installer language identifiers compiled into the Windows installer. */
export const STRATA_NSIS_INSTALLER_LANGUAGES: readonly ['en_US', 'ru_RU', 'zh_CN']

/** Environment variable supplying the production auto-update origin when self-hosted updates are enabled. */
export const STRATA_PRODUCTION_UPDATE_ORIGIN_ENV: 'DOWNLOAD_PROD_ORIGIN'

/** Production fixed auto-update origin; undefined disables upstream DeepSeek CDN fallback. */
export const STRATA_PRODUCTION_UPDATE_FIXED_ORIGIN: undefined

/**
 * Format the electron-builder artifact filename template with an optional qualification suffix.
 * @param suffix - Qualification suffix such as `-unsigned` or `-unnotarized`.
 * @returns electron-builder `artifactName` template.
 */
export function strataArtifactNameTemplate(suffix?: string): string

/**
 * Format the concrete base filename (`strataharness-<version>-<os>-<arch>`) for a built target.
 * @param version - Published build version.
 * @param target - Platform-arch suffix such as `win-x64` or `mac-arm64`.
 * @returns Artifact base name without extension.
 */
export function strataArtifactBaseName(version: string, target: string): string

/**
 * Reject upstream DeepSeek production application identifiers.
 * @param appId - Candidate reverse-DNS application identifier.
 * @returns Validated application identifier.
 */
export function assertIsolatedStrataAppId(appId: string): string

/**
 * Reject upstream DeepSeek CDN update origins so packaged builds never contact download.deepseek.com.
 * @param url - Parsed HTTPS origin.
 * @param settingName - Environment or config field name for diagnostics.
 * @returns Validated HTTPS origin string.
 */
export function assertIsolatedStrataUpdateOrigin(url: URL, settingName: string): string

/**
 * Reject upstream DeepSeek mandatory-update policy servers.
 * @param url - Parsed HTTPS origin.
 * @param settingName - Environment or config field name for diagnostics.
 * @returns Validated HTTPS origin string.
 */
export function assertIsolatedStrataPolicyOrigin(url: URL, settingName: string): string

/**
 * Return extraResources mappings that bundle the StrataHarness methodology and designer skills outside app.asar.
 * @param repositoryRoot - Monorepo root directory.
 * @returns electron-builder extraResources entries.
 */
export function strataBundledExtraResources(repositoryRoot: string): ReadonlyArray<{
  readonly from: string
  readonly to: 'strataharness' | 'strata-skills/designer'
  readonly filter: readonly string[]
}>

/**
 * Read and validate the root `strata-product.json` manifest.
 * @param repositoryRoot - Monorepo root directory containing `strata-product.json`.
 * @returns Validated product manifest.
 */
export function readStrataProductManifest(repositoryRoot?: string): StrataProductManifest

/**
 * Resolve the StrataHarness product SemVer for packaging, installers, and local updater qualification.
 * @param env - Environment that may define `STRATA_PRODUCT_VERSION`.
 * @param repositoryRoot - Monorepo root directory containing `strata-product.json`.
 * @returns Validated StrataHarness product SemVer string.
 */
export function resolveStrataProductVersion(env?: NodeJS.ProcessEnv, repositoryRoot?: string): string
