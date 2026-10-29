/** Resolve and preflight StrataHarness desktop signing modes (`auto`, `unsigned`, `signed`). */

/** Environment variable selecting the StrataHarness desktop signing mode. */
export const STRATA_SIGNING_MODE_ENV: 'STRATA_SIGNING_MODE'

/** Supported input signing mode values. */
export type StrataSigningMode = 'auto' | 'unsigned' | 'signed'

/** Supported signing credential mechanisms across platforms. */
export type StrataSigningMechanism = 'none' | 'pfx' | 'token' | 'apple'

/** Supported StrataHarness desktop signing mode names. */
export const STRATA_SIGNING_MODES: readonly ['auto', 'unsigned', 'signed']

/** Options controlling StrataHarness signing mode resolution and preflight checks. */
export interface ResolveStrataSigningModeOptions {
  readonly mode?: string | undefined
  readonly platform: NodeJS.Platform
  readonly skipNotarization?: boolean | undefined
  readonly env?: NodeJS.ProcessEnv | undefined
}

/** Resolved effective signing mode and secret diagnostic metadata. */
export interface StrataSigningModeResolution {
  readonly requestedMode: StrataSigningMode
  readonly effectiveMode: 'unsigned' | 'signed'
  readonly unsigned: boolean
  readonly signingMechanism: StrataSigningMechanism
  readonly missingSecrets: readonly string[]
}

/**
 * Resolve the effective desktop signing mode and validate platform secret completeness.
 * @param options - Requested mode, target platform, notarization flag, and environment.
 * @returns Resolved signing state.
 * @throws When `mode` or `platform` is unsupported, or when `signed` mode lacks required platform secrets.
 */
export function resolveStrataSigningMode(
  options: ResolveStrataSigningModeOptions,
): StrataSigningModeResolution
