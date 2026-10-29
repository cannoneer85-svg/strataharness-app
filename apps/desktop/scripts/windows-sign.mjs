import { execFile } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import wineVmModule from 'app-builder-lib/out/vm/WineVm.js'
import { beginWindowsSigningAttempt } from './windows-signing-state.mjs'
import { completeWindowsSignature, normalizeWindowsSignature } from './windows-timestamp.mjs'
import { failPackagingRun, recordPackagingEvent } from './packaging-run.mjs'

const execFileAsync = promisify(execFile)
const { WineVmManager } = wineVmModule
const CODE_SIGNING_EKU = '1.3.6.1.5.5.7.3.3'
const NSIS_RUN_AS_INVOKER = 'RunAsInvoker'
const NSIS_BOOTSTRAP_PATCH = Symbol.for('@deepseek-ai/dsh-desktop/nsis-bootstrap-signing')
const WINDOWS_SIGN_SCRIPT = 'windows-sign.cmd'
const WINDOWS_SIGN_SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const PE_HEADER_READ_SIZE = 4096
const PE32_MAGIC = 0x10B
const PE32_PLUS_MAGIC = 0x20B
const SENSITIVE_ENVIRONMENT_NAME = /(?:KEY|SECRET|TOKEN|PASSWORD)/iu
const WINDOWS_SIGNING_ENVIRONMENT_PREFIX = 'DSH_DESKTOP_WINDOWS_'
const CSC_ENVIRONMENT_PREFIX = /^(?:WIN_)?CSC_/iu

/** Default ordered RFC-3161 Timestamp Authority servers for Windows code signing. */
export const DEFAULT_WINDOWS_TSA_SERVERS = Object.freeze([
  'http://timestamp.digicert.com',
  'http://timestamp.sectigo.com',
  'http://timestamp.globalsign.com/tsa/r6advanced1',
])

/**
 * Remove inherited credentials before starting a signing-related subprocess.
 *
 * @param {NodeJS.ProcessEnv} environment Parent environment.
 * @returns {NodeJS.ProcessEnv} Environment without credential-shaped names.
 */
export function scrubWindowsSigningEnvironment(environment) {
  return Object.fromEntries(Object.entries(environment)
    .filter(([name]) => !SENSITIVE_ENVIRONMENT_NAME.test(name)
      && !name.startsWith(WINDOWS_SIGNING_ENVIRONMENT_PREFIX)
      && !CSC_ENVIRONMENT_PREFIX.test(name)))
}

function resolveTokenIdentity(input) {
  const keyContainer = input.keyContainer?.trim()
  if (!keyContainer) {
    throw new Error('DSH_DESKTOP_WINDOWS_KEY_CONTAINER must contain the SafeNet private-key container name')
  }
  if (/["\r\n]/u.test(keyContainer)) {
    throw new Error('DSH_DESKTOP_WINDOWS_KEY_CONTAINER cannot contain quotes or line breaks')
  }
  const tokenPin = input.tokenPin
  if (tokenPin === undefined || tokenPin.length === 0) {
    throw new Error('DSH_DESKTOP_WINDOWS_TOKEN_PIN must contain the SafeNet Token Password')
  }
  if (/[\]"\r\n]/u.test(tokenPin)) {
    throw new Error('DSH_DESKTOP_WINDOWS_TOKEN_PIN cannot contain "]", quotes, or line breaks because the SafeNet key-container syntax uses them as delimiters')
  }
  return { keyContainer, tokenPin }
}

function resolveCertificateFile(value) {
  const candidate = value?.trim()
  if (!candidate) {
    throw new Error('DSH_DESKTOP_WINDOWS_CER_FILE must identify the public X.509 leaf certificate file')
  }
  let path
  let certificate
  try {
    path = realpathSync(candidate)
    certificate = new X509Certificate(readFileSync(path))
  }
  catch {
    throw new Error(`Windows code-signing certificate file is missing or invalid: ${candidate}`)
  }
  if (certificate.ca || !certificate.keyUsage?.includes(CODE_SIGNING_EKU)) {
    throw new Error(`Windows code-signing certificate file must contain a non-CA Code Signing certificate: ${path}`)
  }
  return { path, certificate }
}

/**
 * Pin updater verification to the release certificate's organization, country, and common name.
 *
 * @param {string | undefined} certificateFile Public Windows Code Signing certificate file.
 * @returns {string} Distinguished-name attributes consumed by electron-updater.
 */
export function resolveWindowsUpdatePublisher(certificateFile) {
  const { certificate } = resolveCertificateFile(certificateFile)
  const subject = certificate.toLegacyObject().subject
  // These attributes have identical names in OpenSSL and Windows certificate subjects.
  return ['CN', 'O', 'C'].map((key) => {
    const value = subject[key]
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Windows update publisher requires one nonempty ${key} certificate attribute`)
    }
    const escaped = value.replace(/[\\",;+\x00-\x20]/gu,
      character => `\\${character.charCodeAt(0).toString(16).padStart(2, '0')}`)
    return `${key}=${escaped}`
  }).join(',')
}

function resolveSignTool(value) {
  const candidate = value?.trim()
  if (!candidate) {
    throw new Error('DSH_DESKTOP_WINDOWS_SIGNTOOL must identify the SafeNet-compatible SignTool executable')
  }
  let path
  try {
    path = realpathSync(candidate)
    if (!statSync(path).isFile() || !path.toLowerCase().endsWith('.exe')) throw new Error('not an executable file')
  }
  catch {
    throw new Error(`DSH_DESKTOP_WINDOWS_SIGNTOOL is missing or is not an executable file: ${candidate}`)
  }
  return path
}

function redactedSigningOutput(value, secrets) {
  let output = Buffer.isBuffer(value) ? value.toString('utf8') : typeof value === 'string' ? value : ''
  for (const secret of secrets) {
    if (secret !== '') output = output.replaceAll(secret, '<redacted>')
  }
  return output
}

/**
 * Replace a SignTool failure with a diagnostic that cannot retain its command line.
 *
 * @param {unknown} error SignTool process failure.
 * @param {string} path Artifact that failed signing.
 * @param {readonly string[]} secrets Values that must not appear in the diagnostic.
 * @returns {Error} Sanitized signing failure without the original error as its cause.
 */
export function createRedactedWindowsSigningError(error, path, secrets) {
  const record = error !== null && typeof error === 'object' ? error : undefined
  const code = record !== undefined && 'code' in record
    && (typeof record.code === 'number' || typeof record.code === 'string')
    ? ` (exit ${String(record.code)})`
    : ''
  const stderr = record !== undefined && 'stderr' in record
    ? redactedSigningOutput(record.stderr, secrets).trim()
    : ''
  return new Error(`Windows release signing failed for ${path}${code}${stderr === '' ? '' : `: ${stderr}`}`)
}

/**
 * Build the minimal CMD environment for one Electron artifact.
 *
 * @param {NodeJS.ProcessEnv} environment Parent environment.
 * @param {{ certificateFile: string, signTool: string, path: string, isNest: boolean, tokenPin: string, keyContainer: string }} input Validated signing identity and task.
 * @returns {NodeJS.ProcessEnv} Scrubbed environment plus fields consumed and cleared by the signing CMD.
 */
export function buildWindowsSigningEnvironment(environment, input) {
  return {
    ...scrubWindowsSigningEnvironment(environment),
    DSH_DESKTOP_WINDOWS_SIGNTOOL: input.signTool,
    DSH_DESKTOP_WINDOWS_CER_FILE: input.certificateFile,
    DSH_DESKTOP_WINDOWS_TOKEN_PIN: input.tokenPin,
    DSH_DESKTOP_WINDOWS_KEY_CONTAINER: input.keyContainer,
    DSH_DESKTOP_WINDOWS_SIGN_TARGET: input.path,
    DSH_DESKTOP_WINDOWS_SIGN_APPEND: input.isNest ? '1' : '',
  }
}

/**
 * Serialize SafeNet signing and stop all queued tasks after the first failure.
 *
 * @param {{ certificateFile?: string, signTool?: string, tokenPin?: string, keyContainer?: string, commandInterpreter?: string, runDirectory?: string, stateDirectory?: string, preserveSignature?: (path: string) => Promise<boolean> }} options Release identity, supervised run, verified-copy preservation, and test-only isolated interlock directory.
 * @returns {(configuration: { path: string, hash: string, isNest: boolean }) => Promise<void>} The signing hook.
 */
export function createWindowsTokenSigner(options) {
  const { path: certificateFile, certificate } = resolveCertificateFile(options.certificateFile)
  const signTool = resolveSignTool(options.signTool)
  const { keyContainer, tokenPin } = resolveTokenIdentity(options)
  const commandInterpreter = options.commandInterpreter
    ?? process.env.ComSpec
    ?? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe')
  let pending = Promise.resolve()
  return (configuration) => {
    pending = pending.then(async () => {
      if (configuration.hash !== 'sha256') {
        throw new Error(`Windows release signing requires SHA-256, received ${configuration.hash}`)
      }
      if (configuration.isNest) throw new Error('Windows release signing does not support appended signatures')
      if (await options.preserveSignature?.(configuration.path)) return
      const secrets = [tokenPin]
      const runDirectory = options.runDirectory ?? process.env.DSH_DESKTOP_PACKAGING_RUN_DIR
      if (!runDirectory) throw new Error('Windows hardware signing requires a supervised packaging run')
      const { inspectWindowsRuntimeSignature: inspect } = await import('./windows-runtime-signature.mjs')
      const thumbprint = certificate.fingerprint.replaceAll(':', '')
      try {
        await completeWindowsSignature(configuration.path, {
          thumbprint, inspect, evidenceDirectory: runDirectory,
          record: event => recordPackagingEvent(runDirectory, event),
          normalize: path => normalizeWindowsSignature(path, signTool, scrubWindowsSigningEnvironment(process.env)),
          timestamp: async path => { await execFileAsync(signTool, ['timestamp', '/v', '/tr', 'http://timestamp.digicert.com', '/td', 'sha256', path], {
            env: scrubWindowsSigningEnvironment(process.env), windowsHide: true, timeout: 60_000,
          }) },
          sign: async (path) => {
            await repairDanglingAuthenticodeDirectory(path)
            const attempt = beginWindowsSigningAttempt({ runDirectory,
              stateDirectory: options.stateDirectory, target: path })
            let result
            try {
              const operation = execFileAsync(commandInterpreter, [
                '/d',
                '/v:off',
                '/c',
                WINDOWS_SIGN_SCRIPT,
              ], {
                cwd: WINDOWS_SIGN_SCRIPT_DIRECTORY,
                env: buildWindowsSigningEnvironment(process.env, {
                  certificateFile,
                  signTool,
                  path,
                  isNest: false,
                  tokenPin,
                  keyContainer,
                }),
                windowsHide: true,
              })
              attempt.started(operation.child?.pid ?? null)
              result = await operation
              const signature = await inspect(path)
              if (signature.status !== 'Valid' || signature.timestamped || signature.thumbprint?.toUpperCase() !== thumbprint.toUpperCase()) {
                throw new Error('Windows hardware signing: primary signature verification failed')
              }
            }
            catch (error) {
              const failure = createRedactedWindowsSigningError(error, path, secrets)
              attempt.failure(typeof error.code === 'number' || typeof error.code === 'string' ? error.code : null, failure.message)
              throw failure
            }
            attempt.success()
            const stdout = redactedSigningOutput(result.stdout, secrets)
            const stderr = redactedSigningOutput(result.stderr, secrets)
            if (stdout !== '') process.stdout.write(stdout)
            if (stderr !== '') process.stderr.write(stderr)
          },
        })
      } catch (error) {
        failPackagingRun(runDirectory, 'signature-completion-failed')
        throw error
      }
    })
    return pending
  }
}

/**
 * Clear a certificate-table entry that points beyond the end of a generated executable.
 *
 * @param {string} path Executable to inspect.
 * @returns {Promise<boolean>} Whether an invalid certificate-table entry was cleared.
 */
export async function repairDanglingAuthenticodeDirectory(path) {
  const file = await open(path, 'r+')
  try {
    const { size } = await file.stat()
    const header = Buffer.alloc(Math.min(PE_HEADER_READ_SIZE, size))
    await file.read(header, 0, header.length, 0)
    const directoryOffset = findDanglingAuthenticodeDirectory(header, size)
    if (directoryOffset === undefined) return false
    await file.write(Buffer.alloc(8), 0, 8, directoryOffset)
    return true
  }
  finally {
    await file.close()
  }
}

/**
 * Locate an Authenticode certificate-table entry whose declared bytes are outside the file.
 *
 * @param {Buffer} header Initial executable bytes.
 * @param {number} fileSize Complete file size.
 * @returns {number | undefined} File offset of the invalid data-directory entry.
 */
function findDanglingAuthenticodeDirectory(header, fileSize) {
  if (header.length < 64 || header.toString('ascii', 0, 2) !== 'MZ') return undefined
  const peOffset = header.readUInt32LE(60)
  const optionalHeaderOffset = peOffset + 24
  if (optionalHeaderOffset + 2 > header.length
    || header.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') return undefined
  const magic = header.readUInt16LE(optionalHeaderOffset)
  const dataDirectoryOffset = magic === PE32_MAGIC
    ? optionalHeaderOffset + 96
    : magic === PE32_PLUS_MAGIC
      ? optionalHeaderOffset + 112
      : undefined
  if (dataDirectoryOffset === undefined) return undefined
  const certificateDirectoryOffset = dataDirectoryOffset + (4 * 8)
  if (certificateDirectoryOffset + 8 > header.length) return undefined
  const certificateOffset = header.readUInt32LE(certificateDirectoryOffset)
  const certificateSize = header.readUInt32LE(certificateDirectoryOffset + 4)
  if (certificateOffset === 0 && certificateSize === 0) return undefined
  return certificateOffset > 0
    && certificateSize > 0
    && certificateOffset + certificateSize <= fileSize
    ? undefined
    : certificateDirectoryOffset
}

/**
 * Sign electron-builder's temporary NSIS executable before enterprise code integrity evaluates it.
 *
 * @param {{ sign: (configuration: { path: string, hash: string, isNest: boolean }) => Promise<void>, wineVmManager?: typeof WineVmManager, platform?: NodeJS.Platform, environment?: NodeJS.ProcessEnv }} options Signing hook and injectable host values.
 * @returns {void}
 */
export function installWindowsNsisBootstrapSigner(options) {
  if ((options.platform ?? process.platform) !== 'win32') return
  const prototype = (options.wineVmManager ?? WineVmManager).prototype
  if (prototype[NSIS_BOOTSTRAP_PATCH] === true) return
  const originalExec = prototype.exec
  prototype.exec = async function (file, args, execOptions, isLogOutIfDebug) {
    const isNsisBootstrap = file.toLowerCase().endsWith('.exe')
      && execOptions?.env?.__COMPAT_LAYER === NSIS_RUN_AS_INVOKER
    if (!isNsisBootstrap) {
      return originalExec.call(this, file, args, execOptions, isLogOutIfDebug)
    }
    await options.sign({ path: file, hash: 'sha256', isNest: false })
    return originalExec.call(this, file, args, {
      ...execOptions,
      env: scrubWindowsSigningEnvironment({
        ...(options.environment ?? process.env),
        ...execOptions.env,
      }),
    }, isLogOutIfDebug)
  }
  Object.defineProperty(prototype, NSIS_BOOTSTRAP_PATCH, { value: true })
}

function validateTsaServers(tsaServers = DEFAULT_WINDOWS_TSA_SERVERS) {
  if (!Array.isArray(tsaServers) || tsaServers.length === 0) {
    throw new Error('Windows PFX signing requires at least one RFC-3161 TSA server URL')
  }
  return tsaServers.map((entry) => {
    const trimmed = typeof entry === 'string' ? entry.trim() : ''
    let parsed
    try {
      parsed = new URL(trimmed)
    }
    catch {
      throw new Error(`Windows PFX signing received an invalid RFC-3161 TSA server URL: ${String(entry)}`)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Windows PFX signing requires HTTP(S) RFC-3161 TSA server URLs: ${trimmed}`)
    }
    return trimmed
  })
}

function resolveWindowsPfxSource(pfxLink) {
  const trimmed = typeof pfxLink === 'string' ? pfxLink.trim() : ''
  if (trimmed === '') {
    throw new Error('WIN_CSC_LINK must point to a readable .pfx/.p12 file or contain Base64-encoded PKCS#12 data')
  }
  const dataUriMatch = /^data:[^,]*;base64,(.+)$/isu.exec(trimmed)
  if (dataUriMatch !== null) {
    const compact = dataUriMatch[1].replace(/\s+/gu, '')
    if (compact === '' || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(compact)) {
      throw new Error('WIN_CSC_LINK data URI does not contain valid Base64 PKCS#12 data')
    }
    return { kind: 'base64', bytes: Buffer.from(compact, 'base64') }
  }
  if (trimmed.startsWith('file://')) {
    let resolvedFile
    try {
      resolvedFile = realpathSync(fileURLToPath(trimmed))
      if (!statSync(resolvedFile).isFile()) throw new Error('not a regular file')
    }
    catch {
      throw new Error(`WIN_CSC_LINK certificate file is missing or invalid: ${trimmed}`)
    }
    return { kind: 'file', path: resolvedFile }
  }
  if (existsSync(trimmed)) {
    let resolvedFile
    try {
      resolvedFile = realpathSync(trimmed)
      if (!statSync(resolvedFile).isFile()) throw new Error('not a regular file')
    }
    catch {
      throw new Error(`WIN_CSC_LINK certificate file is missing or invalid: ${trimmed}`)
    }
    return { kind: 'file', path: resolvedFile }
  }
  if (/[\\:]/u.test(trimmed) || /\.(?:pfx|p12)$/iu.test(trimmed)) {
    throw new Error(`WIN_CSC_LINK certificate file is missing or invalid: ${trimmed}`)
  }
  const compact = trimmed.replace(/\s+/gu, '')
  if (compact.length >= 8 && compact.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/u.test(compact)) {
    const bytes = Buffer.from(compact, 'base64')
    if (bytes.length > 0) return { kind: 'base64', bytes }
  }
  throw new Error('WIN_CSC_LINK must point to a readable .pfx/.p12 file or contain Base64-encoded PKCS#12 data')
}

/**
 * Resolve `signtool.exe` from an explicit path, installed Windows 10/11 SDKs, or `PATH`.
 *
 * @param {string | undefined} [signTool] Explicit SignTool path when configured.
 * @param {NodeJS.ProcessEnv} [environment] Environment consulted for SDK roots and `PATH`.
 * @returns {string} Canonical path to `signtool.exe`.
 */
export function resolveWindowsPfxSignTool(signTool, environment = process.env) {
  if (signTool?.trim()) {
    return resolveSignTool(signTool)
  }
  const programRoots = [
    environment['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    environment.ProgramFiles ?? 'C:\\Program Files',
  ]
  for (const programRoot of programRoots) {
    const kitsBin = join(programRoot, 'Windows Kits', '10', 'bin')
    if (!existsSync(kitsBin)) continue
    let rawEntries
    try {
      rawEntries = readdirSync(kitsBin, { withFileTypes: true })
    }
    catch (_readError) {
      // Unreadable SDK root falls through to remaining SDK roots and PATH.
      continue
    }
    const entries = rawEntries
      .filter(entry => entry.isDirectory() && /^\d+\.\d+\.\d+\.\d+$/u.test(entry.name))
      .map(entry => entry.name)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
    for (const version of entries) {
      for (const arch of ['x64', 'x86']) {
        const candidate = join(kitsBin, version, arch, 'signtool.exe')
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          return realpathSync(candidate)
        }
      }
    }
  }
  const pathVar = environment.PATH ?? environment.Path ?? ''
  for (const directory of pathVar.split(delimiter)) {
    const trimmed = directory.trim()
    if (!trimmed) continue
    const candidate = join(trimmed, 'signtool.exe')
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return realpathSync(candidate)
    }
  }
  throw new Error('Windows PFX signing could not locate signtool.exe; set DSH_DESKTOP_WINDOWS_SIGNTOOL or install the Windows 10/11 SDK')
}

/**
 * Timestamp a signed Windows PE artifact across an ordered RFC-3161 TSA server list with round retries.
 *
 * @param {string} path Signed PE artifact path.
 * @param {{ signTool?: string, tsaServers?: readonly string[], rounds?: number, environment?: NodeJS.ProcessEnv, execSignTool?: (file: string, args: readonly string[], options: { env: NodeJS.ProcessEnv, windowsHide: boolean, timeout: number }) => Promise<{ stdout?: string | Buffer, stderr?: string | Buffer }>, wait?: (delayMs: number) => Promise<void> }} [options] TSA list, retry budget, and injectable process runner.
 * @returns {Promise<{ server: string, round: number, attempts: number }>} Winning TSA server and attempt telemetry.
 */
export async function timestampWindowsArtifactWithFallback(path, options = {}) {
  const tsaServers = validateTsaServers(options.tsaServers)
  const rounds = options.rounds ?? 2
  if (!Number.isInteger(rounds) || rounds < 1) {
    throw new Error(`Windows RFC-3161 timestamping requires a positive integer round count, received ${String(rounds)}`)
  }
  const environment = options.environment ?? process.env
  const executable = options.execSignTool !== undefined
    ? (options.signTool?.trim() || 'signtool.exe')
    : resolveWindowsPfxSignTool(options.signTool, environment)
  const runSignTool = options.execSignTool ?? ((file, args, execOptions) => execFileAsync(file, [...args], execOptions))
  const safeEnvironment = scrubWindowsSigningEnvironment(environment)
  const failures = []
  let attempts = 0
  for (let round = 1; round <= rounds; round++) {
    for (const server of tsaServers) {
      attempts += 1
      try {
        await runSignTool(
          executable,
          ['timestamp', '/v', '/tr', server, '/td', 'sha256', path],
          { env: safeEnvironment, windowsHide: true, timeout: 60_000 },
        )
        return { server, round, attempts }
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failures.push(`${server} (round ${round}): ${message}`)
      }
    }
    if (round < rounds) {
      await (options.wait ?? delay)(round * 1000)
    }
  }
  throw new Error(
    `Windows RFC-3161 timestamping failed for ${path} across [${tsaServers.join(', ')}] after ${attempts} attempts: ${failures.at(-1) ?? 'unknown error'}`,
  )
}

/**
 * Create a serialized Windows `.pfx` code-signing hook supporting file paths, Base64 secrets, and RFC-3161 TSA fallback.
 *
 * @param {{ pfxLink?: string, pfxPassword?: string, signTool?: string, tsaServers?: readonly string[], tsaRounds?: number, tempDirectory?: string, environment?: NodeJS.ProcessEnv, preserveSignature?: (path: string) => Promise<boolean>, execSignTool?: (file: string, args: readonly string[], options: { env: NodeJS.ProcessEnv, windowsHide: boolean, timeout: number }) => Promise<{ stdout?: string | Buffer, stderr?: string | Buffer }>, wait?: (delayMs: number) => Promise<void> }} options PFX identity, TSA fallback list, and optional injected executor.
 * @returns {(configuration: { path: string, hash: string, isNest: boolean }) => Promise<void>} Serialized signing hook.
 */
export function createWindowsPfxSigner(options) {
  const pfxSource = resolveWindowsPfxSource(options.pfxLink)
  const pfxPassword = options.pfxPassword
  if (typeof pfxPassword !== 'string' || pfxPassword.trim() === '') {
    throw new Error('WIN_CSC_KEY_PASSWORD must contain the .pfx export password')
  }
  const tsaServers = validateTsaServers(options.tsaServers)
  const environment = options.environment ?? process.env
  const eagerSignTool = options.execSignTool === undefined && options.signTool?.trim()
    ? resolveSignTool(options.signTool)
    : undefined
  const secrets = [
    pfxPassword,
    pfxPassword.trim(),
    ...(typeof options.pfxLink === 'string' && options.pfxLink.trim() !== '' && pfxSource.kind === 'base64'
      ? [options.pfxLink.trim()]
      : []),
  ]
  const runSignTool = options.execSignTool ?? ((file, args, execOptions) => execFileAsync(file, [...args], execOptions))
  let pending = Promise.resolve()
  return (configuration) => {
    pending = pending.then(async () => {
      if (configuration.hash !== 'sha256') {
        throw new Error(`Windows release signing requires SHA-256, received ${configuration.hash}`)
      }
      if (await options.preserveSignature?.(configuration.path)) return
      const executable = eagerSignTool ?? (options.execSignTool !== undefined
        ? (options.signTool?.trim() || 'signtool.exe')
        : resolveWindowsPfxSignTool(options.signTool, environment))
      if (options.execSignTool === undefined || existsSync(configuration.path)) {
        await repairDanglingAuthenticodeDirectory(configuration.path)
      }
      let temporaryDir
      let pfxFilePath = pfxSource.kind === 'file' ? pfxSource.path : undefined
      try {
        if (pfxSource.kind === 'base64') {
          const tempBase = options.tempDirectory?.trim() || environment.RUNNER_TEMP?.trim() || tmpdir()
          temporaryDir = await mkdtemp(join(tempBase, 'strata-pfx-'))
          pfxFilePath = join(temporaryDir, 'signing-cert.pfx')
          await writeFile(pfxFilePath, pfxSource.bytes, { mode: 0o600 })
        }
        let signResult
        try {
          signResult = await runSignTool(
            executable,
            [
              'sign',
              '/v',
              '/fd',
              'sha256',
              ...(configuration.isNest ? ['/as'] : []),
              '/f',
              pfxFilePath,
              '/p',
              pfxPassword,
              configuration.path,
            ],
            {
              env: scrubWindowsSigningEnvironment(environment),
              windowsHide: true,
              timeout: 60_000,
            },
          )
        }
        catch (error) {
          throw createRedactedWindowsSigningError(error, configuration.path, secrets)
        }
        const stdout = redactedSigningOutput(signResult?.stdout, secrets)
        const stderr = redactedSigningOutput(signResult?.stderr, secrets)
        if (stdout !== '') process.stdout.write(stdout)
        if (stderr !== '') process.stderr.write(stderr)
      }
      finally {
        if (temporaryDir !== undefined) {
          await rm(temporaryDir, { recursive: true, force: true })
        }
      }
      await timestampWindowsArtifactWithFallback(configuration.path, {
        signTool: executable,
        tsaServers,
        rounds: options.tsaRounds,
        environment,
        execSignTool: options.execSignTool,
        wait: options.wait,
      })
    })
    return pending
  }
}

/**
 * Create the appropriate Windows release signer (`.pfx` when `WIN_CSC_LINK` is configured, otherwise SafeNet hardware token).
 *
 * @param {{ pfxLink?: string, pfxPassword?: string, certificateFile?: string, signTool?: string, tokenPin?: string, keyContainer?: string, commandInterpreter?: string, runDirectory?: string, stateDirectory?: string, environment?: NodeJS.ProcessEnv, preserveSignature?: (path: string) => Promise<boolean> }} options Combined Windows signing configuration.
 * @returns {(configuration: { path: string, hash: string, isNest: boolean }) => Promise<void>} Serialized signing hook.
 */
export function createWindowsReleaseSigner(options) {
  const env = options.environment ?? process.env
  const pfxLink = options.pfxLink ?? env.WIN_CSC_LINK
  if (typeof pfxLink === 'string' && pfxLink.trim() !== '') {
    return createWindowsPfxSigner({
      pfxLink,
      pfxPassword: options.pfxPassword ?? env.WIN_CSC_KEY_PASSWORD,
      signTool: options.signTool ?? env.DSH_DESKTOP_WINDOWS_SIGNTOOL,
      environment: env,
      preserveSignature: options.preserveSignature,
    })
  }
  return createWindowsTokenSigner(options)
}
