/**
 * Build the minimal CMD environment for one Electron artifact.
 *
 * @param environment Parent environment.
 * @param input Validated signing identity and task.
 * @returns Scrubbed environment plus the fields consumed and cleared by the signing CMD.
 */
export function buildWindowsSigningEnvironment(environment: NodeJS.ProcessEnv, input: {
  certificateFile: string
  signTool: string
  path: string
  isNest: boolean
  tokenPin: string
  keyContainer: string
}): NodeJS.ProcessEnv

/**
 * Pin updater verification to the release certificate's organization, country, and common name.
 * @param certificateFile Public Windows Code Signing certificate file.
 * @returns Distinguished-name attributes consumed by electron-updater.
 */
export function resolveWindowsUpdatePublisher(certificateFile: string | undefined): string

/**
 * Serialize hardware-token signing and stop all queued tasks after the first failure.
 *
 * @param options Release signing configuration.
 * @returns The signing hook.
 */
export function createWindowsTokenSigner(options: {
  certificateFile?: string | undefined
  signTool?: string | undefined
  tokenPin?: string | undefined
  keyContainer?: string | undefined
  commandInterpreter?: string | undefined
  runDirectory?: string | undefined
  stateDirectory?: string | undefined
  preserveSignature?: (path: string) => Promise<boolean>
}): (
  configuration: {
    path: string
    hash: string
    isNest: boolean
  },
) => Promise<void>

/**
 * Remove inherited credentials before starting a signing-related subprocess.
 *
 * @param environment Parent environment.
 * @returns Environment without credential-shaped names.
 */
export function scrubWindowsSigningEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv

/**
 * Replace a SignTool failure with a diagnostic that cannot retain its command line.
 *
 * @param error SignTool process failure.
 * @param path Artifact that failed signing.
 * @param secrets Values that must not appear in the diagnostic.
 * @returns Sanitized signing failure without the original error as its cause.
 */
export function createRedactedWindowsSigningError(
  error: unknown,
  path: string,
  secrets: readonly string[],
): Error

/**
 * Clear a certificate-table entry that points beyond the end of a generated executable.
 *
 * @param path Executable to inspect.
 * @returns Whether an invalid certificate-table entry was cleared.
 */
export function repairDanglingAuthenticodeDirectory(path: string): Promise<boolean>

/** Default ordered RFC-3161 Timestamp Authority servers for Windows code signing. */
export declare const DEFAULT_WINDOWS_TSA_SERVERS: readonly string[]

/** Executable SignTool runner signature injectable into PFX signing and TSA fallback helpers. */
export type WindowsSignToolExecutor = (
  file: string,
  args: readonly string[],
  options: {
    env: NodeJS.ProcessEnv
    windowsHide: boolean
    timeout: number
  },
) => Promise<{
  stdout?: string | Buffer | undefined
  stderr?: string | Buffer | undefined
}>

/**
 * Resolve `signtool.exe` from an explicit path, installed Windows 10/11 SDKs, or `PATH`.
 *
 * @param signTool - Explicit SignTool path when configured.
 * @param environment - Environment consulted for SDK roots and `PATH`.
 * @returns Canonical path to `signtool.exe`.
 */
export function resolveWindowsPfxSignTool(
  signTool?: string | undefined,
  environment?: NodeJS.ProcessEnv,
): string

/**
 * Timestamp a signed Windows PE artifact across an ordered RFC-3161 TSA server list with round retries.
 *
 * @param path - Signed PE artifact path.
 * @param options - TSA list, retry budget, and injectable process runner.
 * @returns Winning TSA server and attempt telemetry.
 */
export function timestampWindowsArtifactWithFallback(
  path: string,
  options?: {
    signTool?: string | undefined
    tsaServers?: readonly string[] | undefined
    rounds?: number | undefined
    environment?: NodeJS.ProcessEnv | undefined
    execSignTool?: WindowsSignToolExecutor | undefined
    wait?: ((delayMs: number) => Promise<void>) | undefined
  },
): Promise<{
  server: string
  round: number
  attempts: number
}>

/**
 * Create a serialized Windows `.pfx` code-signing hook supporting file paths, Base64 secrets, and RFC-3161 TSA fallback.
 *
 * @param options - PFX identity, TSA fallback list, and optional injected executor.
 * @returns Serialized signing hook.
 */
export function createWindowsPfxSigner(options: {
  pfxLink?: string | undefined
  pfxPassword?: string | undefined
  signTool?: string | undefined
  tsaServers?: readonly string[] | undefined
  tsaRounds?: number | undefined
  tempDirectory?: string | undefined
  environment?: NodeJS.ProcessEnv | undefined
  preserveSignature?: ((path: string) => Promise<boolean>) | undefined
  execSignTool?: WindowsSignToolExecutor | undefined
  wait?: ((delayMs: number) => Promise<void>) | undefined
}): (configuration: {
  path: string
  hash: string
  isNest: boolean
}) => Promise<void>

/**
 * Create the appropriate Windows release signer (`.pfx` when `WIN_CSC_LINK` is configured, otherwise SafeNet hardware token).
 *
 * @param options - Combined Windows signing configuration.
 * @returns Serialized signing hook.
 */
export function createWindowsReleaseSigner(options: {
  pfxLink?: string | undefined
  pfxPassword?: string | undefined
  certificateFile?: string | undefined
  signTool?: string | undefined
  tokenPin?: string | undefined
  keyContainer?: string | undefined
  commandInterpreter?: string | undefined
  runDirectory?: string | undefined
  stateDirectory?: string | undefined
  environment?: NodeJS.ProcessEnv | undefined
  preserveSignature?: ((path: string) => Promise<boolean>) | undefined
}): (configuration: {
  path: string
  hash: string
  isNest: boolean
}) => Promise<void>

/**
 * Sign electron-builder's temporary NSIS executable before enterprise code integrity evaluates it.
 *
 * @param options Signing hook and injectable host values.
 * @returns Nothing.
 */
export function installWindowsNsisBootstrapSigner(options: {
  sign: (configuration: {
    path: string
    hash: string
    isNest: boolean
  }) => Promise<void>
  wineVmManager?: {
    prototype: {
      exec: (
        file: string,
        args: string[],
        options?: { env?: NodeJS.ProcessEnv },
        isLogOutIfDebug?: boolean,
      ) => unknown
    }
  }
  platform?: NodeJS.Platform
  environment?: NodeJS.ProcessEnv
}): void
