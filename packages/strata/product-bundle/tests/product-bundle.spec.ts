import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import StrataPaths from '../src/index.ts'

describe('StrataPaths (@strata/product-bundle)', () => {
  const tempDirs: string[] = []
  const originalEnv = process.env.STRATAHARNESS_ROOT
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
    if (originalEnv === undefined) {
      delete process.env.STRATAHARNESS_ROOT
    } else {
      process.env.STRATAHARNESS_ROOT = originalEnv
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

  it('prefers explicit strataHarnessRoot and designerSkillsDir configuration over ambient defaults', async () => {
    const customRoot = makeTempDir('strata-custom-root-')
    const customDesigner = makeTempDir('strata-custom-designer-')
    mkdirSync(join(customRoot, '.agents', 'skills'), { recursive: true })

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

  it('resolves packaged Electron process.resourcesPath/strataharness when present and falls back to monorepo in dev Electron', async () => {
    delete process.env.STRATAHARNESS_ROOT
    const resourcesRoot = makeTempDir('strata-electron-res-')
    const packagedStrata = join(resourcesRoot, 'strataharness')
    mkdirSync(join(packagedStrata, '.agents', 'skills'), { recursive: true })
    setProcessResourcesPath(resourcesRoot)

    const packagedCtx = new Context()
    try {
      await packagedCtx.plugin(SystemPrompt, {})
      await packagedCtx.plugin(StrataPaths)
      expect(packagedCtx.strataPaths.root).toBe(packagedStrata)
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
