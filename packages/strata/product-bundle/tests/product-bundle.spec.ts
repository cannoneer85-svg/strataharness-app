import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentPresetRegistry from '@deepseek-ai/dsh-agent-preset-registry'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { bundlePatchPaths, composeEntries } from '@deepseek-ai/dsh-app-boot/src/profile.ts'
import { Config as SkillOfficeConfig } from '@deepseek-ai/dsh-skill-office'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { Config as ToolOfficeConfig } from '@deepseek-ai/dsh-tool-office'
import { Config as ToolSubagentConfig } from '@deepseek-ai/dsh-tool-subagent'
import { Config as ToolSubagentControlConfig } from '@deepseek-ai/dsh-tool-subagent-control'
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

interface RawPluginEntry {
  id?: string
  name?: string
  disabled?: unknown
  config?: unknown
}

function collectNestedPlugins(entries: readonly RawPluginEntry[]): RawPluginEntry[] {
  const collected: RawPluginEntry[] = []
  for (const entry of entries) {
    collected.push(entry)
    if (Array.isArray(entry.config)) {
      collected.push(...collectNestedPlugins(entry.config as RawPluginEntry[]))
    }
  }
  return collected
}

function loadComposedProductEntries() {
  const repoRoot = resolve(import.meta.dirname, '..', '..', '..', '..')
  const bundleDirs = [
    join(repoRoot, 'packages', 'bundle', 'base'),
    join(repoRoot, 'packages', 'bundle', 'web-app'),
    join(repoRoot, 'packages', 'strata', 'product-bundle'),
  ]
  const warnings: string[] = []
  const layers = bundleDirs.map((dir) => {
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      dsh?: { bundle?: { patch: string | string[] } }
    }
    return bundlePatchPaths(dir, manifest.dsh!.bundle!).flatMap(file => loadOverlayPatches('strata-test', file))
  })
  const entries = composeEntries(layers, message => warnings.push(message))
  return { repoRoot, warnings, entries }
}

describe('Strata preset lineup & overrides (@strata/product-bundle)', () => {
  it('removes legacy strata.patch.yml, sets strata-developer default + strata alias, and composes 6 active presets in order 1..6', async () => {
    const { repoRoot, warnings, entries } = loadComposedProductEntries()
    expect(warnings).toEqual([])

    const bundleRoot = join(repoRoot, 'packages', 'strata', 'product-bundle')
    expect(existsSync(join(bundleRoot, 'presets', 'strata.patch.yml'))).toBe(false)
    const bundleManifest = JSON.parse(readFileSync(join(bundleRoot, 'package.json'), 'utf8')) as {
      files: string[]
      dsh: { bundle: { patch: string[] } }
    }
    expect(bundleManifest.files).not.toContain('presets/strata.patch.yml')
    expect(bundleManifest.dsh.bundle.patch).not.toContain('./presets/strata.patch.yml')

    const registryEntry = entries.find(entry => entry.id === 'agent-preset-registry')
    expect(registryEntry?.config).toEqual({
      default: 'strata-developer',
      aliases: { strata: 'strata-developer' },
    })

    const minimalEntry = entries.find(entry => entry.id === 'preset-minimal')
    expect(minimalEntry?.disabled).toBe(true)

    const activePresetEntries = entries.filter(
      entry => entry.name === '@deepseek-ai/dsh-agent-preset' && entry.disabled !== true,
    )
    const presetDefs = activePresetEntries.map(entry => entry.config as {
      id: string
      order: number
      plugins: RawPluginEntry[]
    })

    const ctx = new Context()
    ctx.provide('loader', {
      readYaml: async () => '',
      entries: [],
      replace: () => {},
    } as never)
    ctx.provide('sessionProjections', {
      register: async () => () => {},
    } as never)
    ctx.provide('agents', {
      scoped: () => new Set(),
      forSession: () => [],
    } as never)

    try {
      await ctx.plugin(AgentPresetRegistry, registryEntry?.config as Record<string, unknown>).await()
      for (const def of presetDefs) {
        await ctx.agentPresets.register(def as never)
      }

      const listed = await ctx.agentPresets.list()
      expect(listed.map(item => item.id)).toEqual([
        'strata-developer',
        'standard',
        'strata-analyst',
        'strata-designer',
        'ptc',
        'cordis',
      ])
      expect(listed.map(item => item.order)).toEqual([1, 2, 3, 4, 5, 6])
      expect(ctx.agentPresets.defaultId).toBe('strata-developer')

      const resolvedAlias = await ctx.agentPresets.resolve('strata')
      expect(resolvedAlias.id).toBe('strata-developer')
      const docAlias = await ctx.agentPresets.readDocument('strata')
      expect(docAlias.agentPreset).toBe('strata-developer')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('unifies tool-result-pruner at 32768 chars and aligns prompts across standard and strata-developer', () => {
    const { repoRoot, entries } = loadComposedProductEntries()
    const presets = new Map(
      entries
        .filter(entry => entry.name === '@deepseek-ai/dsh-agent-preset' && entry.disabled !== true)
        .map((entry) => {
          const cfg = entry.config as { id: string; order: number; plugins: RawPluginEntry[] }
          return [cfg.id, cfg] as const
        }),
    )

    expect([...presets.keys()]).toEqual([
      'standard',
      'ptc',
      'cordis',
      'strata-developer',
      'strata-analyst',
      'strata-designer',
    ].filter(id => presets.has(id)))

    for (const id of ['strata-developer', 'standard', 'strata-analyst', 'strata-designer', 'ptc', 'cordis']) {
      const preset = presets.get(id)
      expect(preset, `missing active preset ${id}`).toBeDefined()
      const nested = collectNestedPlugins(preset!.plugins)
      const pruner = nested.find(row => row.id === 'tool-result-pruner')
      expect(pruner?.config, `${id} pruner mismatch`).toEqual({
        thresholdChars: 32768,
        headChars: 16384,
        tailChars: 4096,
      })
    }

    const standardNested = collectNestedPlugins(presets.get('standard')!.plugins)
    const standardPrefix = (standardNested.find(row => row.id === 'persona')?.config as { prefix?: string } | undefined)?.prefix ?? ''
    expect(standardPrefix).toContain('AGENTS.md')
    expect(standardPrefix).toMatch(/coding standards/i)
    expect(standardPrefix).toMatch(/Skip StrataHarness Step 0/i)

    const devNested = collectNestedPlugins(presets.get('strata-developer')!.plugins)
    const devPrefix = (devNested.find(row => row.id === 'persona')?.config as { prefix?: string } | undefined)?.prefix ?? ''
    expect(devPrefix).toContain('AGENTS.md')
    expect(devPrefix).toContain('.agents/CONTEXT.md')
    expect(devPrefix).toContain('init-project/SKILL.md')
    expect(devPrefix).toContain('pwsh')

    const skillDirs = readdirSync(join(repoRoot, 'resources', 'strataharness', '.agents', 'skills'), {
      withFileTypes: true,
    }).filter(entry => entry.isDirectory())
    expect(skillDirs).toHaveLength(41)
  })

  it('aligns Office host/preset separation and 0.2.2-rc.3 delegation schemas across all Strata presets', () => {
    const { entries } = loadComposedProductEntries()

    const hostSkillOffice = entries.find(entry => entry.id === 'skill-office')
    expect(hostSkillOffice?.name).toBe('@deepseek-ai/dsh-skill-office')
    expect(SkillOfficeConfig({ pythonEnvironment: 'user' })).toEqual({ pythonEnvironment: 'user' })
    expect(SkillOfficeConfig({ pythonEnvironment: 'workspace-dependencies' })).toEqual({
      pythonEnvironment: 'workspace-dependencies',
    })

    const toolOfficeDefaults = ToolOfficeConfig({})
    expect(toolOfficeDefaults.activationSkills).toEqual(['office', 'office-docx', 'office-xlsx', 'office-pptx'])

    const activePresets = entries
      .filter(entry => entry.name === '@deepseek-ai/dsh-agent-preset' && entry.disabled !== true)
      .map(entry => entry.config as { id: string; plugins: RawPluginEntry[] })

    for (const preset of activePresets) {
      const nested = collectNestedPlugins(preset.plugins)
      expect(nested.some(row => row.name === '@deepseek-ai/dsh-skill-office')).toBe(false)
      expect(nested.some(row => row.name === '@deepseek-ai/dsh-tool-subagent-control/list-agents')).toBe(false)

      if (preset.id === 'strata-developer' || preset.id === 'strata-analyst' || preset.id === 'standard' || preset.id === 'ptc') {
        expect(nested.some(row => row.name === '@deepseek-ai/dsh-tool-office')).toBe(true)
      }

      const subagentCtrl = nested.find(row => row.name === '@deepseek-ai/dsh-tool-subagent-control')
      if (subagentCtrl !== undefined) {
        const parsedCtrl = ToolSubagentControlConfig(subagentCtrl.config ?? {})
        expect(parsedCtrl.interrupt).toBe(false)
      }

      for (const spawnRow of nested.filter(row => row.name === '@deepseek-ai/dsh-tool-subagent')) {
        expect(spawnRow.config).not.toHaveProperty('modelSelectionSettings')
        const parsedSpawn = ToolSubagentConfig(spawnRow.config as Parameters<typeof ToolSubagentConfig>[0])
        if (spawnRow.id === 'tool-subagent') {
          expect(parsedSpawn.modelSelection).toBe(true)
          expect(parsedSpawn.modelDiscovery).toBe(true)
        } else {
          expect(parsedSpawn.modelSelection).toBe(false)
          expect(parsedSpawn.modelDiscovery).toBe(false)
        }
      }
    }

    const analystNested = collectNestedPlugins(activePresets.find(preset => preset.id === 'strata-analyst')!.plugins)
    const analystPrefix = (analystNested.find(row => row.id === 'persona')?.config as { prefix?: string } | undefined)?.prefix ?? ''
    for (const skillName of toolOfficeDefaults.activationSkills) {
      expect(analystPrefix).toContain(skillName)
    }
    expect(analystPrefix).not.toContain('office-pdf')
    expect(analystPrefix).not.toContain('office-export-pdf')
  })
})
