/**
 * Host path-resolution service for the bundled StrataHarness methodology and
 * role-specific skill directories, plus the `{{strata_root}}` prompt variable.
 *
 * @module @strata/product-bundle
 */

import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-system-prompt'

declare module '@deepseek-ai/cordis' {
  interface Context {
    strataPaths: StrataPaths
  }
}

/** Optional configuration overrides for locating StrataHarness methodology and role skill directories. */
export interface StrataPathsConfig {
  /** Explicit filesystem path to the StrataHarness repository root containing `.agents/skills`. */
  strataHarnessRoot?: string
  /** Explicit filesystem path to the role-specific designer skills directory. */
  designerSkillsDir?: string
}

function isDirectory(target: string): boolean {
  try {
    return statSync(target).isDirectory()
  } catch (_missingOrInaccessible) {
    return false
  }
}

function resolvePackageDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..')
}

function resolveStrataHarnessRoot(packageDir: string, explicitRoot?: string): string {
  const configured = explicitRoot?.trim() || process.env.STRATAHARNESS_ROOT?.trim()
  if (configured !== undefined && configured.length > 0) {
    return resolve(configured)
  }

  const electronProcess = process as NodeJS.Process & { readonly resourcesPath?: string }
  if (typeof electronProcess.resourcesPath === 'string' && electronProcess.resourcesPath.length > 0) {
    const packagedCandidate = resolve(electronProcess.resourcesPath, 'strataharness')
    if (existsSync(join(packagedCandidate, '.agents', 'skills'))) {
      return packagedCandidate
    }
  }

  return resolve(packageDir, '..', '..', '..', 'resources', 'strataharness')
}

function resolveDesignerSkillsDir(packageDir: string, explicitDir?: string): string {
  const configured = explicitDir?.trim()
  if (configured !== undefined && configured.length > 0) {
    return resolve(configured)
  }
  return resolve(packageDir, 'skills', 'designer')
}

/**
 * Resolves and validates on-disk directories for bundled StrataHarness skills
 * and exposes `{{strata_root}}` (normalized with forward slashes) to system prompts.
 */
export class StrataPaths extends Service {
  static inject = ['systemPrompt']

  static Config: z<StrataPathsConfig> = z.object({
    strataHarnessRoot: z.string(),
    designerSkillsDir: z.string(),
  })

  /** Validated absolute path to the StrataHarness methodology root. */
  readonly root: string

  /** Validated absolute path to `<root>/.agents/skills` for `skill-filesystem` `bundledSkillDir`. */
  readonly bundledSkillsDir: string

  /** Validated absolute path to the extensible `skills/designer` directory for `Strata Designer`. */
  readonly designerSkillsDir: string

  constructor(ctx: Context, config: StrataPathsConfig = {}) {
    const packageDir = resolvePackageDir()
    const root = resolveStrataHarnessRoot(packageDir, config.strataHarnessRoot)
    const bundledSkillsDir = join(root, '.agents', 'skills')
    if (!isDirectory(bundledSkillsDir)) {
      throw new Error(
        `strata-product-bundle: StrataHarness skills directory not found at "${bundledSkillsDir}". `
        + 'Initialize the resources/strataharness git submodule or set STRATAHARNESS_ROOT.',
      )
    }
    const designerSkillsDir = resolveDesignerSkillsDir(packageDir, config.designerSkillsDir)
    if (!isDirectory(designerSkillsDir)) {
      throw new Error(
        `strata-product-bundle: designer skills directory not found at "${designerSkillsDir}".`,
      )
    }
    super(ctx, 'strataPaths')
    this.root = root
    this.bundledSkillsDir = bundledSkillsDir
    this.designerSkillsDir = designerSkillsDir

    const promptRoot = root.replaceAll('\\', '/')
    ctx.effect(
      () => ctx.systemPrompt.variable('strata_root', () => promptRoot),
      'strataPaths.variable(strata_root)',
    )
  }
}

export default StrataPaths
