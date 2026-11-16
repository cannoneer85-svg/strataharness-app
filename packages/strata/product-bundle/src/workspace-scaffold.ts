/**
 * Workspace scaffolding plugin for StrataHarness methodology presets.
 *
 * Ensures `.agents/` and `docs/` directories plus starter methodology templates
 * exist in the session working directory before `agent-instructions` reads disk
 * on `agent/pre-step`.
 */

import { realpathSync } from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import * as os from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-working-directory'
import type {} from './index.ts'

/** Cordis plugin name for automatic StrataHarness workspace scaffolding. */
export const name = 'strata-workspace-scaffold'

/** Host services required to resolve session working directories and starter templates. */
export const inject = ['agents', 'workingDirectory', 'strataPaths'] as const

const SCAFFOLD_DIRECTORIES = [
  '.agents',
  'docs/adr',
  'docs/agents',
  'docs/analysis',
  'docs/handoff',
  'docs/research',
  'docs/specs',
] as const

const SCAFFOLD_FILES: ReadonlyArray<readonly [templateFile: string, targetRelativePath: string]> = [
  ['CODING_STANDARDS.md', 'CODING_STANDARDS.md'],
  ['CONTEXT.md', '.agents/CONTEXT.md'],
  ['LATEST.md', 'docs/handoff/LATEST.md'],
  ['domain.md', 'docs/agents/domain.md'],
  ['issue-tracker-local.md', 'docs/agents/issue-tracker.md'],
  ['triage-labels.md', 'docs/agents/triage-labels.md'],
]

function canonicalizeDirectoryPath(directory: string): string {
  const resolved = resolve(directory)
  try {
    return realpathSync(resolved)
  } catch (_missingOrInaccessible) {
    return resolved
  }
}

function normalizeDirectoryKey(directory: string): string {
  const canonical = canonicalizeDirectoryPath(directory)
  return process.platform === 'win32' || process.platform === 'darwin'
    ? canonical.toLowerCase()
    : canonical
}

function isFileAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

/**
 * Determine whether `targetDirectory` points to a protected path (empty path,
 * filesystem root, user home directory, or OS temp root) that automatic
 * workspace scaffolding must never populate.
 *
 * @param targetDirectory - Candidate workspace path to check.
 * @returns `true` when scaffolding must skip `targetDirectory`.
 */
export function isProtectedScaffoldDirectory(targetDirectory: string): boolean {
  const trimmed = targetDirectory.trim()
  if (trimmed.length === 0) return true
  const resolved = resolve(trimmed)
  if (dirname(resolved) === resolved) return true
  const targetKey = normalizeDirectoryKey(resolved)
  return [os.homedir(), os.tmpdir()].some(
    candidate => normalizeDirectoryKey(candidate) === targetKey,
  )
}

/**
 * Ensure StrataHarness methodology directories and missing starter files exist
 * inside `targetDirectory` without overwriting existing files or copying
 * `.agents/skills/` or `AGENTS.md`.
 *
 * @param targetDirectory - Session working directory to scaffold.
 * @param strataRoot - Resolved StrataHarness root containing `.agents/skills/init-project/templates`.
 * @param signal - Optional cancellation signal checked before and between filesystem operations.
 * @returns `true` when scaffolding ran, or `false` when skipped because `targetDirectory` is protected.
 */
export async function scaffoldStrataWorkspace(
  targetDirectory: string,
  strataRoot: string,
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted()
  if (isProtectedScaffoldDirectory(targetDirectory)) {
    return false
  }

  const resolvedTarget = resolve(targetDirectory)
  const templateDir = join(resolve(strataRoot), '.agents', 'skills', 'init-project', 'templates')

  for (const relativeDir of SCAFFOLD_DIRECTORIES) {
    signal?.throwIfAborted()
    await fsPromises.mkdir(resolve(resolvedTarget, relativeDir), { recursive: true })
  }

  for (const [templateFile, targetRelativePath] of SCAFFOLD_FILES) {
    signal?.throwIfAborted()
    const destination = resolve(resolvedTarget, targetRelativePath)
    const content = await fsPromises.readFile(join(templateDir, templateFile), 'utf8')
    signal?.throwIfAborted()
    try {
      await fsPromises.writeFile(destination, content, { encoding: 'utf8', flag: 'wx' })
    } catch (error: unknown) {
      if (isFileAlreadyExistsError(error)) continue
      throw error
    }
  }

  return true
}

/**
 * Register the `agent/pre-step` waterfall hook that ensures workspace scaffolding
 * runs before `agent-instructions` reads disk.
 *
 * @param ctx - Cordis context providing `agents`, `workingDirectory`, and `strataPaths`.
 */
export function apply(ctx: Context): void {
  const scaffoldedDirectories = new Set<string>()
  const scaffoldLocks = new Map<string, Promise<void>>()

  ctx.on('agent/pre-step', async ({ agent, signal }, next): Promise<PreStepDecision> => {
    const cwd = await ctx.workingDirectory.ensure(agent, signal)
    signal.throwIfAborted()
    const cacheKey = normalizeDirectoryKey(cwd)
    if (!scaffoldedDirectories.has(cacheKey)) {
      const previous = scaffoldLocks.get(cacheKey) ?? Promise.resolve()
      const run = previous.then(async () => {
        if (scaffoldedDirectories.has(cacheKey)) return
        signal.throwIfAborted()
        try {
          await scaffoldStrataWorkspace(cwd, ctx.strataPaths.root, signal)
          scaffoldedDirectories.add(cacheKey)
        } catch (error: unknown) {
          if (signal.aborted) throw error
          ctx.logger.warn('strata workspace scaffold skipped for %s: %o', cwd, error)
        }
      })
      const settled = run.then(() => undefined, () => undefined)
      scaffoldLocks.set(cacheKey, settled)
      try {
        await run
      } finally {
        if (scaffoldLocks.get(cacheKey) === settled) {
          scaffoldLocks.delete(cacheKey)
        }
      }
    }
    return next()
  })
}
