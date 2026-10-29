/** Resolve and preflight StrataHarness desktop signing modes (`auto`, `unsigned`, `signed`). */

/** Environment variable selecting the StrataHarness desktop signing mode. */
export const STRATA_SIGNING_MODE_ENV = 'STRATA_SIGNING_MODE'

/** Supported StrataHarness desktop signing mode names. */
export const STRATA_SIGNING_MODES = Object.freeze(['auto', 'unsigned', 'signed'])

const WINDOWS_PFX_REQUIRED = Object.freeze(['WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD'])
const WINDOWS_TOKEN_REQUIRED = Object.freeze([
  'DSH_DESKTOP_WINDOWS_CER_FILE',
  'DSH_DESKTOP_WINDOWS_SIGNTOOL',
  'DSH_DESKTOP_WINDOWS_KEY_CONTAINER',
  'DSH_DESKTOP_WINDOWS_TOKEN_PIN',
])

const MACOS_BASE_SIGNING_REQUIRED = Object.freeze([
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'DSH_DESKTOP_MACOS_SIGNING_IDENTITY',
  'DSH_DESKTOP_MACOS_TEAM_ID',
])

const MACOS_NOTARIZATION_STRATEGIES = Object.freeze([
  Object.freeze(['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']),
  Object.freeze(['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']),
  Object.freeze(['APPLE_KEYCHAIN_PROFILE']),
])

/**
 * Check whether an environment variable holds a non-whitespace value.
 * @param {NodeJS.ProcessEnv} env - Source environment.
 * @param {string} name - Variable name.
 * @returns {boolean} True when present and non-whitespace.
 */
function hasSecret(env, name) {
  const value = env[name]
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * Resolve the requested signing mode from explicit input or environment variables.
 * @param {string | undefined} explicitMode - Direct caller mode override.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @returns {'auto' | 'unsigned' | 'signed'} Validated requested signing mode.
 */
function resolveRequestedMode(explicitMode, env) {
  const direct = explicitMode?.trim()
  if (direct !== undefined && direct !== '') {
    if (direct === 'auto' || direct === 'unsigned' || direct === 'signed') return direct
    throw new Error(`strata signing mode: unsupported signing mode ${JSON.stringify(direct)}; expected "auto", "unsigned", or "signed"`)
  }
  const configured = env[STRATA_SIGNING_MODE_ENV]?.trim()
  if (configured !== undefined && configured !== '') {
    if (configured === 'auto' || configured === 'unsigned' || configured === 'signed') return configured
    throw new Error(`strata signing mode: unsupported signing mode ${JSON.stringify(configured)}; expected "auto", "unsigned", or "signed"`)
  }
  if (env.DSH_DESKTOP_UNSIGNED !== undefined) {
    if (env.DSH_DESKTOP_UNSIGNED === '1') return 'unsigned'
    if (env.DSH_DESKTOP_UNSIGNED === '0') return 'signed'
    throw new Error('desktop package: DSH_DESKTOP_UNSIGNED must be 0 or 1')
  }
  return 'auto'
}

/**
 * Inspect Windows signing credentials across cloud `.pfx` and SafeNet hardware token sets.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @returns {{ mechanism: 'pfx' | 'token' | 'none', missingSecrets: string[] }} Detected mechanism or missing secret list.
 */
function evaluateWindowsSecrets(env) {
  const missingPfx = WINDOWS_PFX_REQUIRED.filter(name => !hasSecret(env, name))
  if (missingPfx.length === 0) {
    return { mechanism: 'pfx', missingSecrets: [] }
  }
  const missingToken = WINDOWS_TOKEN_REQUIRED.filter(name => !hasSecret(env, name))
  if (missingToken.length === 0) {
    return { mechanism: 'token', missingSecrets: [] }
  }
  const hasAnyPfx = missingPfx.length < WINDOWS_PFX_REQUIRED.length
  const hasAnyToken = missingToken.length < WINDOWS_TOKEN_REQUIRED.length
  if (hasAnyToken && !hasAnyPfx) {
    return { mechanism: 'none', missingSecrets: missingToken }
  }
  return { mechanism: 'none', missingSecrets: missingPfx }
}

/**
 * Inspect macOS Developer ID signing and optional Apple notarization credentials.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @param {boolean} skipNotarization - Whether notarization credentials are omitted for internal debugging builds.
 * @returns {{ mechanism: 'apple' | 'none', missingSecrets: string[] }} Detected mechanism or missing secret list.
 */
function evaluateMacOSSecrets(env, skipNotarization) {
  const missingSigning = MACOS_BASE_SIGNING_REQUIRED.filter(name => !hasSecret(env, name))
  if (skipNotarization) {
    return missingSigning.length === 0
      ? { mechanism: 'apple', missingSecrets: [] }
      : { mechanism: 'none', missingSecrets: missingSigning }
  }
  for (const strategy of MACOS_NOTARIZATION_STRATEGIES) {
    if (strategy.every(name => hasSecret(env, name))) {
      return missingSigning.length === 0
        ? { mechanism: 'apple', missingSecrets: [] }
        : { mechanism: 'none', missingSecrets: missingSigning }
    }
  }
  const partialStrategy = MACOS_NOTARIZATION_STRATEGIES.find(strategy =>
    strategy.some(name => hasSecret(env, name)),
  )
  const missingNotarization = (partialStrategy ?? MACOS_NOTARIZATION_STRATEGIES[0]).filter(
    name => !hasSecret(env, name),
  )
  return {
    mechanism: 'none',
    missingSecrets: [...missingSigning, ...missingNotarization],
  }
}

/**
 * Resolve the effective desktop signing mode and validate platform secret completeness.
 * @param {{ mode?: string, platform: NodeJS.Platform, skipNotarization?: boolean, env?: NodeJS.ProcessEnv }} options - Requested mode, target platform, notarization flag, and environment.
 * @returns {{ requestedMode: 'auto' | 'unsigned' | 'signed', effectiveMode: 'unsigned' | 'signed', unsigned: boolean, signingMechanism: 'none' | 'pfx' | 'token' | 'apple', missingSecrets: string[] }} Resolved signing state.
 */
export function resolveStrataSigningMode(options) {
  const env = options.env ?? process.env
  const platform = options.platform
  if (platform !== 'win32' && platform !== 'darwin') {
    throw new Error(`strata signing mode: unsupported platform ${JSON.stringify(platform)}; expected "win32" or "darwin"`)
  }
  const requestedMode = resolveRequestedMode(options.mode, env)
  if (requestedMode === 'unsigned') {
    return {
      requestedMode: 'unsigned',
      effectiveMode: 'unsigned',
      unsigned: true,
      signingMechanism: 'none',
      missingSecrets: [],
    }
  }
  const evaluation = platform === 'win32'
    ? evaluateWindowsSecrets(env)
    : evaluateMacOSSecrets(env, options.skipNotarization === true)
  if (evaluation.mechanism !== 'none') {
    return {
      requestedMode,
      effectiveMode: 'signed',
      unsigned: false,
      signingMechanism: evaluation.mechanism,
      missingSecrets: [],
    }
  }
  if (requestedMode === 'signed') {
    throw new Error(
      `strata signing preflight: signed mode on ${platform} is missing required environment variables: ${evaluation.missingSecrets.join(', ')}`,
    )
  }
  return {
    requestedMode: 'auto',
    effectiveMode: 'unsigned',
    unsigned: true,
    signingMechanism: 'none',
    missingSecrets: evaluation.missingSecrets,
  }
}
