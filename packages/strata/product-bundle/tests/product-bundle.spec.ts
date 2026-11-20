import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import { createRequire } from 'node:module'
import * as os from 'node:os'
import { tmpdir } from 'node:os'
import { dirname, join, parse, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import * as AgentInstructions from '@deepseek-ai/dsh-agent-instructions'
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
} from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentPresetRegistry from '@deepseek-ai/dsh-agent-preset-registry'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { bundlePatchPaths, composeEntries } from '@deepseek-ai/dsh-app-boot/src/profile.ts'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as SkillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import { Config as SkillOfficeConfig } from '@deepseek-ai/dsh-skill-office'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { Config as ToolOfficeConfig } from '@deepseek-ai/dsh-tool-office'
import { Config as ToolSubagentConfig } from '@deepseek-ai/dsh-tool-subagent'
import { Config as ToolSubagentControlConfig } from '@deepseek-ai/dsh-tool-subagent-control'
import { afterEach, describe, expect, it, vi } from 'vitest'
import StrataPaths, { resolveDesignerSkillsDir, resolveStrataHarnessRoot } from '../src/index.ts'
import * as WorkspaceScaffold from '../src/workspace-scaffold.ts'
import { isProtectedScaffoldDirectory, scaffoldStrataWorkspace } from '../src/workspace-scaffold.ts'

vi.mock('node:fs/promises', { spy: true })
vi.mock('node:os', { spy: true })

function createTrackedTempDir(tempDirs: string[], prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('StrataPaths (@strata/product-bundle)', () => {
  const tempDirs: string[] = []
  const originalRootEnv = process.env.STRATAHARNESS_ROOT
  const originalDesignerEnv = process.env.STRATA_DESIGNER_SKILLS_DIR
  const originalResourcesDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath')

  function makeTempDir(prefix: string): string {
    return createTrackedTempDir(tempDirs, prefix)
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

function activePresetsById(entries: readonly RawPluginEntry[]) {
  return new Map(
    entries
      .filter(entry => entry.name === '@deepseek-ai/dsh-agent-preset' && entry.disabled !== true)
      .map((entry) => {
        const cfg = entry.config as { id: string; order: number; plugins: RawPluginEntry[] }
        return [cfg.id, cfg] as const
      }),
  )
}

function collectSourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath))
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      files.push(fullPath)
    }
  }
  return files
}

function collectProvidedServices(pkgRoot: string): Set<string> {
  const services = new Set<string>()
  for (const filePath of collectSourceFiles(join(pkgRoot, 'src'))) {
    const source = readFileSync(filePath, 'utf8')
    for (const match of source.matchAll(/(?:super\(ctx,\s*|provide\()['"]([^'"]+)['"]/g)) {
      if (match[1] !== undefined) services.add(match[1])
    }
  }
  return services
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
  it('removes legacy/disabled overlays, sets standard default + strata alias, configures office-kit, and composes 4 active presets', async () => {
    const { repoRoot, warnings, entries } = loadComposedProductEntries()
    expect(warnings).toEqual([])

    const bundleRoot = join(repoRoot, 'packages', 'strata', 'product-bundle')
    expect(existsSync(join(bundleRoot, 'presets', 'strata.patch.yml'))).toBe(false)
    expect(existsSync(join(bundleRoot, 'presets', 'ptc.patch.yml'))).toBe(false)
    expect(existsSync(join(bundleRoot, 'presets', 'cordis.patch.yml'))).toBe(false)
    const bundleManifest = JSON.parse(readFileSync(join(bundleRoot, 'package.json'), 'utf8')) as {
      files: string[]
      dsh: { bundle: { patch: string[] } }
    }
    expect(bundleManifest.files).not.toContain('presets/strata.patch.yml')
    expect(bundleManifest.files).not.toContain('presets/ptc.patch.yml')
    expect(bundleManifest.files).not.toContain('presets/cordis.patch.yml')
    expect(bundleManifest.dsh.bundle.patch).not.toContain('./presets/strata.patch.yml')
    expect(bundleManifest.dsh.bundle.patch).not.toContain('./presets/ptc.patch.yml')
    expect(bundleManifest.dsh.bundle.patch).not.toContain('./presets/cordis.patch.yml')

    const registryEntry = entries.find(entry => entry.id === 'agent-preset-registry')
    expect(registryEntry?.config).toEqual({
      default: 'standard',
      aliases: {
        strata: 'strata-developer',
        cordis: 'strata-developer',
      },
    })

    for (const disabledId of ['preset-minimal', 'preset-ptc', 'preset-cordis']) {
      expect(entries.find(entry => entry.id === disabledId)?.disabled, `${disabledId} should be disabled`).toBe(true)
    }

    const officeKitEntry = entries.find(entry => entry.id === 'office-kit')
    expect(officeKitEntry?.config).toEqual({
      timeoutMs: 120000,
    })

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
        'standard',
        'strata-developer',
        'strata-analyst',
        'strata-designer',
      ])
      expect(listed.map(item => item.order)).toEqual([1, 2, 3, 4])
      expect(ctx.agentPresets.defaultId).toBe('standard')

      const resolvedAlias = await ctx.agentPresets.resolve('strata')
      expect(resolvedAlias.id).toBe('strata-developer')
      const docAlias = await ctx.agentPresets.readDocument('strata')
      expect(docAlias.agentPreset).toBe('strata-developer')

      const resolvedCordisAlias = await ctx.agentPresets.resolve('cordis')
      expect(resolvedCordisAlias.id).toBe('strata-developer')
      if (resolvedCordisAlias.broken !== undefined) {
        expect(resolvedCordisAlias.broken).not.toMatch(/SyntaxError|MODULE_NOT_FOUND|customSkillDirs/)
      }
      const docCordisAlias = await ctx.agentPresets.readDocument('cordis')
      expect(docCordisAlias.agentPreset).toBe('strata-developer')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('unifies pruner/instructions/scaffolding across presets and keeps standard clean of Strata skills', () => {
    const { repoRoot, entries } = loadComposedProductEntries()
    const presets = activePresetsById(entries)

    expect([...presets.keys()]).toEqual([
      'standard',
      'strata-developer',
      'strata-analyst',
      'strata-designer',
    ])

    for (const id of ['standard', 'strata-developer', 'strata-analyst', 'strata-designer']) {
      const preset = presets.get(id)
      expect(preset, `missing active preset ${id}`).toBeDefined()
      const nested = collectNestedPlugins(preset!.plugins)
      const pruner = nested.find(row => row.id === 'tool-result-pruner')
      expect(pruner?.config, `${id} pruner mismatch`).toEqual({
        thresholdChars: 32768,
        headChars: 16384,
        tailChars: 4096,
      })

      const instructions = nested.find(row => row.id === 'agent-instructions')
      expect(instructions?.config, `${id} agent-instructions mismatch`).toEqual({
        maxBytes: 65536,
        instructionFileCandidates: ['AGENTS.md', 'CLAUDE.md', 'CODING_STANDARDS.md'],
      })

      const skillFs = nested.find(row => row.id === 'skill-filesystem')
      if (id === 'standard') {
        expect(skillFs?.config).not.toHaveProperty('bundledSkillDir')
        expect(nested.some(row => row.id === 'strata-workspace-scaffold')).toBe(false)
      } else {
        expect(skillFs?.config).toHaveProperty('bundledSkillDir')
        const scaffoldIndex = preset!.plugins.findIndex(row => row.id === 'strata-workspace-scaffold')
        const instructionsIndex = preset!.plugins.findIndex(row => row.id === 'agent-instructions')
        expect(scaffoldIndex, `${id} missing strata-workspace-scaffold`).toBeGreaterThanOrEqual(0)
        expect(preset!.plugins[scaffoldIndex]?.name).toBe('@strata/product-bundle/workspace-scaffold')
        expect(scaffoldIndex).toBeLessThan(instructionsIndex)
      }
    }

    const standardNested = collectNestedPlugins(presets.get('standard')!.plugins)
    const standardPrefix = (standardNested.find(row => row.id === 'persona')?.config as { prefix?: string } | undefined)?.prefix ?? ''
    expect(standardPrefix).toContain('AGENTS.md')
    expect(standardPrefix).toMatch(/coding standards/i)
    expect(standardPrefix).toMatch(/Skip StrataHarness Step 0/i)

    const devNested = collectNestedPlugins(presets.get('strata-developer')!.plugins)
    const devPrefix = (devNested.find(row => row.id === 'persona')?.config as { prefix?: string } | undefined)?.prefix ?? ''
    expect(devPrefix).toContain('.agents/CONTEXT.md')
    expect(devPrefix).not.toContain('Optional project scaffolding')
    expect(devPrefix).not.toContain('init-project/SKILL.md')
    expect(devPrefix).not.toContain('pwsh')

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

      if (preset.id === 'strata-developer' || preset.id === 'strata-analyst' || preset.id === 'standard') {
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

  it('equips strata-developer with plugin creation tools and loads dsh-doc alongside bundled Strata skills', async () => {
    const { repoRoot, entries } = loadComposedProductEntries()
    const presets = activePresetsById(entries)

    const devPlugins = collectNestedPlugins(presets.get('strata-developer')!.plugins)
    expect(devPlugins.find(row => row.id === 'tool-cordis')).toMatchObject({
      id: 'tool-cordis',
      name: '@deepseek-ai/dsh-tool-cordis',
    })
    for (const toolId of ['tool-plugin-manager', 'tool-plugin-market'] as const) {
      const row = devPlugins.find(item => item.id === toolId)
      expect(row?.name).toBe(
        toolId === 'tool-plugin-manager' ? '@deepseek-ai/dsh-plugin-manager/tools' : '@deepseek-ai/dsh-plugin-market/tools',
      )
      const disabledExpr = (row?.disabled as { __jsExpr?: string } | undefined)?.__jsExpr
      expect(typeof disabledExpr).toBe('string')
      const withoutProfile = runInNewContext(disabledExpr!, { ctx: { get: () => undefined } }) as boolean
      const withProfile = runInNewContext(disabledExpr!, { ctx: { get: (k: string) => (k === 'profileContext' ? {} : undefined) } }) as boolean
      expect(withoutProfile).toBe(true)
      expect(withProfile).toBe(false)
    }

    const skillFsConfig = devPlugins.find(row => row.id === 'skill-filesystem')?.config as {
      bundledSkillDir?: unknown
      customSkillDirs?: unknown[]
    } | undefined
    expect(skillFsConfig?.bundledSkillDir).toBeDefined()
    expect(Array.isArray(skillFsConfig?.customSkillDirs)).toBe(true)
    expect(skillFsConfig?.customSkillDirs).toHaveLength(1)

    const developerPatchUrl = pathToFileURL(
      join(repoRoot, 'packages', 'strata', 'product-bundle', 'presets', 'strata-developer.patch.yml'),
    ).href
    const bundlePackageUrl = pathToFileURL(
      join(repoRoot, 'packages', 'strata', 'product-bundle', 'package.json'),
    ).href
    const customSkillExpr = (skillFsConfig?.customSkillDirs?.[0] as { __jsExpr?: string } | undefined)?.__jsExpr
    expect(typeof customSkillExpr).toBe('string')
    const presetSkillsDir = runInNewContext(customSkillExpr!, { process, baseUrl: developerPatchUrl }) as string
    const presetSkillsDirFromBundleRoot = runInNewContext(customSkillExpr!, { process, baseUrl: bundlePackageUrl }) as string
    expect(presetSkillsDirFromBundleRoot).toBe(presetSkillsDir)
    expect(existsSync(join(presetSkillsDir, 'dsh-doc', 'SKILL.md'))).toBe(true)

    const bundledSkillsDir = join(repoRoot, 'resources', 'strataharness', '.agents', 'skills')
    let registeredProvider: { list: (opts: Record<string, unknown>) => Promise<Array<{ name: string }>> } | undefined
    const ctx = new Context()
    const controller = new AbortController()
    ctx.provide('skills', {
      registerProvider(factory: (control: unknown) => typeof registeredProvider) {
        registeredProvider = factory({ invalidate: () => {}, signal: controller.signal })
        return () => { controller.abort() }
      },
    } as never)
    try {
      await ctx.plugin(SkillFilesystem, {
        includeDefaultRoots: false,
        watch: false,
        bundledSkillDir: bundledSkillsDir,
        customSkillDirs: [presetSkillsDir],
      }).await()
      const discovered = await registeredProvider!.list({})
      const names = discovered.map(item => item.name)
      expect(names).toContain('dsh-doc')
      expect(names).toContain('tdd')
      expect(names).toContain('grill-with-docs')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('disables ui-account-notifications and keeps active client plugins free of disabled service dependencies', () => {
    const { repoRoot, entries } = loadComposedProductEntries()

    expect(entries.find(entry => entry.id === 'ui-account-notifications')?.disabled).toBe(true)

    const bundleResolvers = [
      createRequire(join(repoRoot, 'packages', 'bundle', 'base', 'package.json')),
      createRequire(join(repoRoot, 'packages', 'bundle', 'web-app', 'package.json')),
      createRequire(join(repoRoot, 'packages', 'strata', 'product-bundle', 'package.json')),
    ]
    const resolvePkgJson = (pkgName: string): string | undefined => {
      for (const req of bundleResolvers) {
        try {
          return req.resolve(`${pkgName}/package.json`)
        } catch (_notInLayer) {
          // Package is not directly declared in this layer's dependencies; probe the next bundle resolver.
        }
      }
      return undefined
    }

    const packageNameOf = (entryName: string): string => {
      if (!entryName.startsWith('@')) return entryName.split('/')[0]!
      const [scope, pkg] = entryName.split('/')
      return `${scope}/${pkg}`
    }

    const activePackages = new Set(
      entries.flatMap(entry =>
        entry.disabled !== true && typeof entry.name === 'string' ? [packageNameOf(entry.name)] : [],
      ),
    )
    const disabledPackages = new Set(
      entries
        .flatMap(entry =>
          entry.disabled === true && typeof entry.name === 'string' ? [packageNameOf(entry.name)] : [],
        )
        .filter(pkgName => !activePackages.has(pkgName)),
    )

    const activeProvidedServices = new Set<string>()
    for (const pkgName of activePackages) {
      const pkgJsonPath = resolvePkgJson(pkgName)
      if (pkgJsonPath === undefined) continue
      for (const svc of collectProvidedServices(dirname(pkgJsonPath))) {
        activeProvidedServices.add(svc)
      }
    }

    const disabledServices = new Set<string>(['remote.account', 'accountUi', 'remote.productAnalytics', 'remote.sessionLog', 'deepseekAccount'])
    for (const pkgName of disabledPackages) {
      const pkgJsonPath = resolvePkgJson(pkgName)
      if (pkgJsonPath === undefined) continue
      for (const svc of collectProvidedServices(dirname(pkgJsonPath))) {
        if (!activeProvidedServices.has(svc)) disabledServices.add(svc)
      }
    }

    for (const entry of entries) {
      if (entry.disabled === true || typeof entry.name !== 'string') continue
      if (!entry.name.startsWith('@deepseek-ai/dsh-') && !entry.name.startsWith('@strata/')) continue
      const pkgName = packageNameOf(entry.name)
      const pkgJsonPath = resolvePkgJson(pkgName)
      if (pkgJsonPath === undefined) continue
      const manifest = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
        dsh?: { client?: { inject?: string[] } }
      }
      if (manifest.dsh?.client === undefined) continue

      for (const depPkg of manifest.dsh.client.inject ?? []) {
        expect(
          disabledPackages.has(depPkg),
          `${entry.id} (${pkgName}) declares dsh.client.inject dependency ${depPkg}, which is disabled`,
        ).toBe(false)
      }

      for (const clientFile of collectSourceFiles(join(dirname(pkgJsonPath), 'src', 'client'))) {
        const source = readFileSync(clientFile, 'utf8')
        const injectMatches = source.matchAll(/(?:export\s+const|static)\s+inject(?:\s*:\s*[^=]+)?\s*=\s*\[([^\]]*)\]/gs)
        for (const injectMatch of injectMatches) {
          const injectedServices = [...injectMatch[1]!.matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]!)
          for (const service of injectedServices) {
            expect(
              disabledServices.has(service),
              `${entry.id} (${pkgName}) injects disabled service "${service}" in ${clientFile}`,
            ).toBe(false)
          }
        }
      }
    }
  })
})

describe('workspace scaffold plugin (@strata/product-bundle/workspace-scaffold)', () => {
  const tempDirs: string[] = []
  const contexts: Context[] = []
  const strataRoot = resolve(import.meta.dirname, '..', '..', '..', '..', 'resources', 'strataharness')
  const templateRoot = join(strataRoot, '.agents', 'skills', 'init-project', 'templates')

  afterEach(async () => {
    vi.restoreAllMocks()
    while (contexts.length > 0) {
      const ctx = contexts.pop()
      if (ctx !== undefined) await ctx.fiber.dispose()
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
    }
  })

  it('detects empty, root, home, and temp directories as protected with platform case and symlink semantics', () => {
    expect(isProtectedScaffoldDirectory('')).toBe(true)
    expect(isProtectedScaffoldDirectory('   ')).toBe(true)
    expect(isProtectedScaffoldDirectory(parse(process.cwd()).root)).toBe(true)
    expect(isProtectedScaffoldDirectory(os.homedir())).toBe(true)
    expect(isProtectedScaffoldDirectory(os.tmpdir())).toBe(true)

    const parent = createTrackedTempDir(tempDirs, 'strata-home-parent-')
    const realProtectedDir = join(parent, 'real-protected-home')
    mkdirSync(realProtectedDir, { recursive: true })
    const linkedProtectedDir = join(parent, 'linked-protected-home')
    symlinkSync(realProtectedDir, linkedProtectedDir, process.platform === 'win32' ? 'junction' : 'dir')
    vi.spyOn(os, 'homedir').mockReturnValue(linkedProtectedDir)
    expect(isProtectedScaffoldDirectory(realProtectedDir)).toBe(true)

    const fakeHome = join(parent, 'MockHome')
    const swappedCaseHome = join(parent, 'mockhome')
    vi.spyOn(os, 'homedir').mockReturnValue(fakeHome)

    const platformSpy = vi.spyOn(process, 'platform', 'get')
    platformSpy.mockReturnValue('win32')
    expect(isProtectedScaffoldDirectory(swappedCaseHome)).toBe(true)
    platformSpy.mockReturnValue('darwin')
    expect(isProtectedScaffoldDirectory(swappedCaseHome)).toBe(true)
    platformSpy.mockReturnValue('linux')
    expect(isProtectedScaffoldDirectory(fakeHome)).toBe(true)
    expect(isProtectedScaffoldDirectory(swappedCaseHome)).toBe(false)

    const projectDir = join(parent, 'my-project')
    expect(isProtectedScaffoldDirectory(projectDir)).toBe(false)
  })

  it('creates missing directories and starter templates without overwriting existing files or copying skills/AGENTS.md', async () => {
    expect(await scaffoldStrataWorkspace(os.tmpdir(), strataRoot)).toBe(false)

    const abortedController = new AbortController()
    abortedController.abort(new Error('already cancelled'))
    await expect(
      scaffoldStrataWorkspace(createTrackedTempDir(tempDirs, 'strata-aborted-'), strataRoot, abortedController.signal),
    ).rejects.toThrow('already cancelled')

    const workspace = createTrackedTempDir(tempDirs, 'strata-scaffold-fresh-')
    expect(await scaffoldStrataWorkspace(workspace, strataRoot)).toBe(true)

    for (const relDir of ['.agents', 'docs/adr', 'docs/agents', 'docs/analysis', 'docs/handoff', 'docs/research', 'docs/specs']) {
      expect(existsSync(join(workspace, relDir)), `expected directory ${relDir}`).toBe(true)
    }

    const expectedTemplates: ReadonlyArray<readonly [string, string]> = [
      ['CODING_STANDARDS.md', 'CODING_STANDARDS.md'],
      ['CONTEXT.md', '.agents/CONTEXT.md'],
      ['LATEST.md', 'docs/handoff/LATEST.md'],
      ['domain.md', 'docs/agents/domain.md'],
      ['issue-tracker-local.md', 'docs/agents/issue-tracker.md'],
      ['triage-labels.md', 'docs/agents/triage-labels.md'],
    ]

    for (const [templateFile, targetRelPath] of expectedTemplates) {
      expect(readFileSync(join(workspace, targetRelPath), 'utf8')).toBe(readFileSync(join(templateRoot, templateFile), 'utf8'))
    }
    expect(existsSync(join(workspace, '.agents', 'skills'))).toBe(false)
    expect(existsSync(join(workspace, 'AGENTS.md'))).toBe(false)

    const customWorkspace = createTrackedTempDir(tempDirs, 'strata-scaffold-existing-')
    const customStandards = '# Project Coding Standards\nCustom rule\n'
    const customContext = '# Existing CONTEXT\n'
    mkdirSync(join(customWorkspace, '.agents'), { recursive: true })
    writeFileSync(join(customWorkspace, 'CODING_STANDARDS.md'), customStandards, 'utf8')
    writeFileSync(join(customWorkspace, '.agents', 'CONTEXT.md'), customContext, 'utf8')

    expect(await scaffoldStrataWorkspace(customWorkspace, strataRoot)).toBe(true)
    expect(readFileSync(join(customWorkspace, 'CODING_STANDARDS.md'), 'utf8')).toBe(customStandards)
    expect(readFileSync(join(customWorkspace, '.agents', 'CONTEXT.md'), 'utf8')).toBe(customContext)
    expect(readFileSync(join(customWorkspace, 'docs/handoff/LATEST.md'), 'utf8')).toBe(
      readFileSync(join(templateRoot, 'LATEST.md'), 'utf8'),
    )
  })

  it('rethrows non-EEXIST writeFile errors cleanly', async () => {
    const workspace = createTrackedTempDir(tempDirs, 'strata-write-err-')
    const writeSpy = vi.spyOn(fsPromises, 'writeFile')

    writeSpy.mockRejectedValueOnce(Object.assign(new Error('permission denied'), { code: 'EACCES' }))
    await expect(scaffoldStrataWorkspace(workspace, strataRoot)).rejects.toThrow('permission denied')

    writeSpy.mockRejectedValueOnce(new Error('plain failure'))
    await expect(scaffoldStrataWorkspace(workspace, strataRoot)).rejects.toThrow('plain failure')

    writeSpy.mockRejectedValueOnce('non-error failure')
    await expect(scaffoldStrataWorkspace(workspace, strataRoot)).rejects.toBe('non-error failure')
  })

  it('scaffolds before agent-instructions on step 1, caches directory checks, warns on errors, and respects AbortSignal', async () => {
    const workspace = createTrackedTempDir(tempDirs, 'strata-prestep-e2e-')
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
    await ctx.plugin(StrataPaths, { strataHarnessRoot: strataRoot })
    await ctx.plugin(WorkspaceScaffold)
    await ctx.plugin(AgentInstructions, {
      maxBytes: 65536,
      instructionFileCandidates: ['AGENTS.md', 'CLAUDE.md', 'CODING_STANDARDS.md'],
    })

    const harness = await mountAgentLoopTestHarness(ctx)
    const agent = await harness.create(SessionId('strata-scaffold-step1'), {}, { cwd: workspace })
    const userMsg = createUserMessage({
      content: [{ type: 'text', text: 'Inspect project setup' }],
      source: { kind: 'user' },
    })

    const mkdirSpy = vi.spyOn(fsPromises, 'mkdir')
    const decision1 = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      {
        modelSelection: { provider: 'mock', model: 'mock' },
        messages: [userMsg],
        turn: 1,
        step: 1,
        signal: new AbortController().signal,
      },
      async () => ({ kind: 'enter' as const, messages: [userMsg] }),
    )

    expect(decision1.kind).toBe('enter')
    if (decision1.kind !== 'enter') throw new Error('expected enter decision')
    expect(existsSync(join(workspace, 'CODING_STANDARDS.md'))).toBe(true)

    const injectedText = decision1.messages
      .map(message => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content)))
      .join('\n')
    expect(injectedText).toContain('CODING_STANDARDS.md')
    expect(injectedText).toContain('# Стандарты кодирования')
    expect(mkdirSpy.mock.calls.length).toBeGreaterThan(0)

    mkdirSpy.mockClear()
    const decision2 = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      {
        modelSelection: { provider: 'mock', model: 'mock' },
        messages: [userMsg],
        turn: 1,
        step: 2,
        signal: new AbortController().signal,
      },
      async () => ({ kind: 'enter' as const, messages: [userMsg] }),
    )
    expect(decision2.kind).toBe('enter')
    expect(mkdirSpy).not.toHaveBeenCalled()

    const errWorkspace = createTrackedTempDir(tempDirs, 'strata-prestep-err-')
    const warnCtx = new Context()
    contexts.push(warnCtx)
    await mountAgentLoopTestDependencies(warnCtx, { workingDirectory: true })
    await warnCtx.plugin(StrataPaths, { strataHarnessRoot: strataRoot })
    const scaffoldPlugin = await warnCtx.plugin(WorkspaceScaffold)
    const warnSpy = vi.spyOn(scaffoldPlugin.ctx.logger, 'warn').mockImplementation(() => {})
    const warnHarness = await mountAgentLoopTestHarness(warnCtx)
    const warnAgent = await warnHarness.create(SessionId('strata-scaffold-warn'), {}, { cwd: errWorkspace })

    vi.spyOn(fsPromises, 'mkdir').mockRejectedValueOnce(Object.assign(new Error('read-only fs'), { code: 'EROFS' }))
    const warnDecision = await agentEvents(warnCtx, warnAgent).waterfall(
      'agent/pre-step',
      {
        modelSelection: { provider: 'mock', model: 'mock' },
        messages: [userMsg],
        turn: 1,
        step: 1,
        signal: new AbortController().signal,
      },
      async () => ({ kind: 'enter' as const, messages: [userMsg] }),
    )
    expect(warnDecision.kind).toBe('enter')
    expect(warnSpy).toHaveBeenCalledTimes(1)

    const abortController = new AbortController()
    vi.spyOn(fsPromises, 'mkdir').mockImplementationOnce(async () => {
      abortController.abort(new Error('step aborted mid-scaffold'))
      throw new Error('mkdir failed during abort')
    })
    await expect(
      agentEvents(warnCtx, warnAgent).waterfall(
        'agent/pre-step',
        {
          modelSelection: { provider: 'mock', model: 'mock' },
          messages: [userMsg],
          turn: 1,
          step: 2,
          signal: abortController.signal,
        },
        async () => ({ kind: 'enter' as const, messages: [userMsg] }),
      ),
    ).rejects.toThrow('mkdir failed during abort')

    const concurrentWorkspace = createTrackedTempDir(tempDirs, 'strata-prestep-concurrent-')
    const concurrentCtx = new Context()
    contexts.push(concurrentCtx)
    await mountAgentLoopTestDependencies(concurrentCtx, { workingDirectory: true })
    await concurrentCtx.plugin(StrataPaths, { strataHarnessRoot: strataRoot })
    await concurrentCtx.plugin(WorkspaceScaffold)
    await concurrentCtx.plugin(AgentInstructions, {
      maxBytes: 65536,
      instructionFileCandidates: ['AGENTS.md', 'CLAUDE.md', 'CODING_STANDARDS.md'],
    })
    const concurrentHarness = await mountAgentLoopTestHarness(concurrentCtx)
    const agentA = await concurrentHarness.create(SessionId('strata-concurrent-a'), {}, { cwd: concurrentWorkspace })
    const agentB = await concurrentHarness.create(SessionId('strata-concurrent-b'), {}, { cwd: concurrentWorkspace })
    let releaseGate!: () => void
    const gate = new Promise<void>((resolveGate) => { releaseGate = resolveGate })
    let enteredFirstMkdir!: () => void
    const firstMkdirStarted = new Promise<void>((resolveStarted) => { enteredFirstMkdir = resolveStarted })
    mkdirSpy.mockClear()
    mkdirSpy.mockImplementationOnce(async (target, opts) => {
      enteredFirstMkdir()
      await gate
      mkdirSync(String(target), opts as { recursive?: boolean })
      return undefined
    })
    const concurrentWriteSpy = vi.spyOn(fsPromises, 'writeFile')
    const nextCalls: string[] = []
    const promiseA = agentEvents(concurrentCtx, agentA).waterfall(
      'agent/pre-step',
      {
        modelSelection: { provider: 'mock', model: 'mock' },
        messages: [userMsg],
        turn: 1,
        step: 1,
        signal: new AbortController().signal,
      },
      async () => {
        nextCalls.push('A')
        return { kind: 'enter' as const, messages: [userMsg] }
      },
    )
    const promiseB = agentEvents(concurrentCtx, agentB).waterfall(
      'agent/pre-step',
      {
        modelSelection: { provider: 'mock', model: 'mock' },
        messages: [userMsg],
        turn: 1,
        step: 1,
        signal: new AbortController().signal,
      },
      async () => {
        nextCalls.push('B')
        return { kind: 'enter' as const, messages: [userMsg] }
      },
    )
    await firstMkdirStarted
    await Promise.resolve()
    await Promise.resolve()
    expect(nextCalls).toEqual([])
    releaseGate()
    const [resA, resB] = await Promise.all([promiseA, promiseB])
    expect([...nextCalls].sort()).toEqual(['A', 'B'])
    expect(mkdirSpy).toHaveBeenCalledTimes(7)
    const workspaceWrites = concurrentWriteSpy.mock.calls.filter(([dest]) =>
      typeof dest === 'string' && dest.startsWith(concurrentWorkspace),
    )
    expect(workspaceWrites).toHaveLength(6)
    for (const res of [resA, resB]) {
      expect(res.kind).toBe('enter')
      if (res.kind !== 'enter') throw new Error('expected enter decision')
      const joined = res.messages.map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n')
      expect(joined).toContain('CODING_STANDARDS.md')
    }
  })
})
