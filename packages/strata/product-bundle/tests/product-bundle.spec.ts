import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import StrataPaths, { resolveDesignerSkillsDir, resolveStrataHarnessRoot } from '../src/index.ts'

describe('StrataPaths (@strata/product-bundle)', () => {
  const tempDirs: string[] = []
  const originalRootEnv = process.env.STRATAHARNESS_ROOT
  const originalDesignerEnv = process.env.STRATA_DESIGNER_SKILLS_DIR
  const originalResourcesDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath')

  function makeTempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
  }

  function setProcessResourcesPath(value: string): void {
    Object.defineProperty(process, 'resourcesPath', {
      value,
      configurable: true,
      writable: true,
    })
  }

  afterEach(() => {
    if (originalRootEnv === undefined) {
      delete process.env.STRATAHARNESS_ROOT
    } else {
      process.env.STRATAHARNESS_ROOT = originalRootEnv
    }
    if (originalDesignerEnv === undefined) {
      delete process.env.STRATA_DESIGNER_SKILLS_DIR
    } else {
      process.env.STRATA_DESIGNER_SKILLS_DIR = originalDesignerEnv
    }
    if (originalResourcesDescriptor === undefined) {
      Reflect.deleteProperty(process, 'resourcesPath')
    } else {
      Object.defineProperty(process, 'resourcesPath', originalResourcesDescriptor)
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolves the monorepo resources/strataharness submodule and registers {{strata_root}}', async () => {
    delete process.env.STRATAHARNESS_ROOT
    delete process.env.STRATA_DESIGNER_SKILLS_DIR
    Reflect.deleteProperty(process, 'resourcesPath')

    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, personaPrefix: 'Root: {{strata_root}}' })
      await ctx.plugin(StrataPaths)

      expect(ctx.strataPaths.root).toContain('strataharness')
      expect(ctx.strataPaths.bundledSkillsDir).toBe(join(ctx.strataPaths.root, '.agents', 'skills'))
      expect(ctx.strataPaths.designerSkillsDir).toContain(join('skills', 'designer'))

      const assembled = await ctx.systemPrompt.assemble()
      expect(renderPrompt(assembled)).toBe(`Root: ${ctx.strataPaths.root.replaceAll('\\', '/')}`)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('prefers explicit configuration and environment overrides over ambient defaults', async () => {
    const customRoot = makeTempDir('strata-custom-root-')
    const customDesigner = makeTempDir('strata-custom-designer-')
    mkdirSync(join(customRoot, '.agents', 'skills'), { recursive: true })

    process.env.STRATAHARNESS_ROOT = customRoot
    process.env.STRATA_DESIGNER_SKILLS_DIR = customDesigner
    expect(resolveStrataHarnessRoot('/unused/package')).toBe(customRoot)
    expect(resolveDesignerSkillsDir('/unused/package')).toBe(customDesigner)
    delete process.env.STRATAHARNESS_ROOT
    delete process.env.STRATA_DESIGNER_SKILLS_DIR

    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt, {})
      await ctx.plugin(StrataPaths, {
        strataHarnessRoot: customRoot,
        designerSkillsDir: customDesigner,
      })

      expect(ctx.strataPaths.root).toBe(customRoot)
      expect(ctx.strataPaths.bundledSkillsDir).toBe(join(customRoot, '.agents', 'skills'))
      expect(ctx.strataPaths.designerSkillsDir).toBe(customDesigner)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('resolves packaged Electron process.resourcesPath directories and falls back to workspace in dev Electron', async () => {
    delete process.env.STRATAHARNESS_ROOT
    delete process.env.STRATA_DESIGNER_SKILLS_DIR
    const resourcesRoot = makeTempDir('strata-electron-res-')
    const packagedStrata = join(resourcesRoot, 'strataharness')
    const packagedDesigner = join(resourcesRoot, 'strata-skills', 'designer')
    mkdirSync(join(packagedStrata, '.agents', 'skills'), { recursive: true })
    mkdirSync(packagedDesigner, { recursive: true })
    setProcessResourcesPath(resourcesRoot)

    const packagedCtx = new Context()
    try {
      await packagedCtx.plugin(SystemPrompt, {})
      await packagedCtx.plugin(StrataPaths)
      expect(packagedCtx.strataPaths.root).toBe(packagedStrata)
      expect(packagedCtx.strataPaths.designerSkillsDir).toBe(packagedDesigner)
    } finally {
      await packagedCtx.fiber.dispose()
    }

    const devResourcesRoot = makeTempDir('strata-electron-dev-')
    setProcessResourcesPath(devResourcesRoot)
    const devCtx = new Context()
    try {
      await devCtx.plugin(SystemPrompt, {})
      await devCtx.plugin(StrataPaths)
      expect(devCtx.strataPaths.root).toContain(join('resources', 'strataharness'))
    } finally {
      await devCtx.fiber.dispose()
    }
  })

  it('resolves packaged app.asar and prepared .desktop-build trees under ELECTRON_RUN_AS_NODE without process.resourcesPath', () => {
    delete process.env.STRATAHARNESS_ROOT
    delete process.env.STRATA_DESIGNER_SKILLS_DIR
    Reflect.deleteProperty(process, 'resourcesPath')

    const installRoot = makeTempDir('strata-installed-app-')
    const resourcesDir = join(installRoot, 'resources')
    const asarPackageDir = join(resourcesDir, 'app.asar', 'dsh', 'node_modules', '@strata', 'product-bundle')
    const extraStrata = join(resourcesDir, 'strataharness')
    const extraDesigner = join(resourcesDir, 'strata-skills', 'designer')
    mkdirSync(asarPackageDir, { recursive: true })
    mkdirSync(join(extraStrata, '.agents', 'skills'), { recursive: true })
    mkdirSync(extraDesigner, { recursive: true })

    expect(resolveStrataHarnessRoot(asarPackageDir)).toBe(extraStrata)
    expect(resolveDesignerSkillsDir(asarPackageDir)).toBe(extraDesigner)

    const repoRoot = makeTempDir('strata-prepared-repo-')
    const repoStrata = join(repoRoot, 'resources', 'strataharness')
    const preparedPackageDir = join(
      repoRoot,
      'apps',
      'desktop',
      '.desktop-build',
      'targets',
      'win-x64',
      'dsh',
      'node_modules',
      '@strata',
      'product-bundle',
    )
    mkdirSync(join(repoStrata, '.agents', 'skills'), { recursive: true })
    mkdirSync(join(preparedPackageDir, 'skills', 'designer'), { recursive: true })

    expect(resolveStrataHarnessRoot(preparedPackageDir)).toBe(repoStrata)
    expect(resolveDesignerSkillsDir(preparedPackageDir)).toBe(join(preparedPackageDir, 'skills', 'designer'))

    const isolatedPackageDir = join(makeTempDir('strata-uninitialized-'), 'packages', 'strata', 'product-bundle')
    mkdirSync(isolatedPackageDir, { recursive: true })
    expect(resolveStrataHarnessRoot(isolatedPackageDir)).toBe(
      resolve(isolatedPackageDir, '..', '..', '..', 'resources', 'strataharness'),
    )
    expect(resolveDesignerSkillsDir(isolatedPackageDir)).toBe(join(isolatedPackageDir, 'skills', 'designer'))
  })

  it('fails loud when either StrataHarness skills or designer skills directory is missing', async () => {
    const emptyRoot = makeTempDir('strata-invalid-root-')
    const validRoot = makeTempDir('strata-valid-root-')
    mkdirSync(join(validRoot, '.agents', 'skills'), { recursive: true })
    const missingDesigner = join(emptyRoot, 'nonexistent-designer')

    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt, {})
      expect(() => new StrataPaths(ctx, { strataHarnessRoot: emptyRoot })).toThrow(
        /StrataHarness skills directory not found/,
      )
      expect(() => new StrataPaths(ctx, { strataHarnessRoot: validRoot, designerSkillsDir: missingDesigner })).toThrow(
        /designer skills directory not found/,
      )
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
