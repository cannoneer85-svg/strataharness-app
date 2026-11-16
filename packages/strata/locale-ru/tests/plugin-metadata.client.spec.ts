// @vitest-environment jsdom
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import {
  apply as localeApply,
  inject as localeInject,
  type LocaleRuntime,
} from '@deepseek-ai/dsh-client-locale/client'
import { LOCALE_CONFIG_GLOBAL } from '@deepseek-ai/dsh-client-locale/src/locale-settings.ts'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  en as enSettingsPluginInventory,
  zh as zhSettingsPluginInventory,
} from '@deepseek-ai/dsh-client-ui-settings-plugin-inventory/src/client/locales.ts'
import {
  PluginInventorySettingsTab,
  type PluginInventorySettingsTabInjected,
  type PluginInventorySettingsTabProps,
} from '@deepseek-ai/dsh-client-ui-settings-plugin-inventory/src/client/PluginInventorySettingsTab.tsx'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { ruPluginMetadataCatalog } from '../src/client/locales/plugin-metadata.ts'
import { apply as hostApply } from '../src/index.ts'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..')
const IGNORED_DIRS = new Set(['node_modules', 'lib', 'dist', 'tests', '.git'])
const INTENTIONAL_LATIN_TITLES = new Set(['DSH'])

interface LocaleMetaJson {
  readonly meta?: {
    readonly title?: string
    readonly description?: string
  }
}

interface PackageManifestJson {
  readonly name?: string
  readonly description?: string
  readonly files?: readonly string[]
}

interface LocalizedRecord {
  readonly [locale: string]: string
  readonly en: string
}

interface DiscoveredPluginMeta {
  readonly source: string
  readonly title: LocalizedRecord | undefined
  readonly description: LocalizedRecord | undefined
}

function walkLocaleEnFiles(dir: string, inLocaleDir = false, results: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      walkLocaleEnFiles(join(dir, entry.name), inLocaleDir || entry.name === 'locale', results)
    } else if (inLocaleDir && entry.isFile() && entry.name === 'en.json') {
      results.push(join(dir, entry.name))
    }
  }
  return results
}

function readLocaleMeta(filePath: string): LocaleMetaJson {
  return JSON.parse(readFileSync(filePath, 'utf8')) as LocaleMetaJson
}

function readPackageManifest(filePath: string): PackageManifestJson {
  return JSON.parse(readFileSync(filePath, 'utf8')) as PackageManifestJson
}

function buildLocalizedRecord(
  enValue: string | undefined,
  zhValue: string | undefined,
  ruValue: string | undefined,
): LocalizedRecord | undefined {
  if (typeof enValue !== 'string' || enValue.length === 0) return undefined
  return {
    en: enValue,
    ...(typeof zhValue === 'string' && zhValue.length > 0 ? { zh: zhValue } : {}),
    ...(typeof ruValue === 'string' && ruValue.length > 0 ? { ru: ruValue } : {}),
  }
}

function discoverBuiltInPluginMetadata(): DiscoveredPluginMeta[] {
  const enFiles = [
    ...walkLocaleEnFiles(join(REPO_ROOT, 'packages')),
    ...walkLocaleEnFiles(join(REPO_ROOT, 'vendor')),
  ].sort()

  return enFiles.map((enFile) => {
    const dir = dirname(enFile)
    const zhFile = join(dir, 'zh.json')
    const ruFile = join(dir, 'ru.json')
    const rootPkgFile = join(dir, '..', 'package.json')

    const enDoc = readLocaleMeta(enFile)
    const zhDoc = existsSync(zhFile) ? readLocaleMeta(zhFile) : undefined
    const ruDoc = existsSync(ruFile) ? readLocaleMeta(ruFile) : undefined
    const pkgDoc = existsSync(rootPkgFile) ? readPackageManifest(rootPkgFile) : undefined

    const effectiveEnDescription = enDoc.meta?.description
      ?? (zhDoc?.meta?.description !== undefined || ruDoc?.meta?.description !== undefined
        ? pkgDoc?.description
        : undefined)

    return {
      source: relative(REPO_ROOT, enFile).replaceAll('\\', '/'),
      title: buildLocalizedRecord(enDoc.meta?.title, zhDoc?.meta?.title, ruDoc?.meta?.title),
      description: buildLocalizedRecord(
        effectiveEnDescription,
        zhDoc?.meta?.description,
        ruDoc?.meta?.description,
      ),
    }
  })
}

interface OfficialCatalogEntryShape {
  readonly packageName: string
  readonly meta: {
    readonly title?: string | LocalizedRecord
    readonly description?: string | LocalizedRecord
  }
}

async function discoverOfficialBundleMetadata(): Promise<DiscoveredPluginMeta[]> {
  const generatedPath = join(REPO_ROOT, 'packages', 'util', 'official-bundles', 'src', 'catalog.generated.ts')
  const mod = await import(pathToFileURL(generatedPath).href) as {
    readonly OFFICIAL_ON_DEMAND_CATALOG: readonly OfficialCatalogEntryShape[]
  }
  return mod.OFFICIAL_ON_DEMAND_CATALOG.map(entry => ({
    source: `official-bundle:${entry.packageName}`,
    title: typeof entry.meta.title === 'string'
      ? { en: entry.meta.title }
      : entry.meta.title,
    description: typeof entry.meta.description === 'string'
      ? { en: entry.meta.description }
      : entry.meta.description,
  }))
}

function filesCoverRuLocale(files: readonly string[] | undefined): boolean {
  if (files === undefined) return false
  return files.includes('locale/ru.json')
    || files.includes('locale/*.json')
    || files.includes('locale')
    || files.includes('locale/')
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function bootLocaleWithRu() {
  vi.stubGlobal('navigator', { languages: ['ru-RU', 'en-US'], language: 'ru-RU' })
  vi.stubGlobal(LOCALE_CONFIG_GLOBAL, {
    defaultLocale: 'ru',
    localeOrder: ['ru', 'en', 'zh'],
  })
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  new TestRemote(ctx, {
    settings: {
      describe: async () => ({
        ok: true as const,
        value: { writable: true, hasDocument: true, namespaces: [] },
      }),
      mutate: async () => ({
        ok: false as const,
        error: { code: 'READ_ONLY' as const, message: 'unused' },
      }),
    },
  })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  await ctx.plugin({ inject: [...localeInject], apply: localeApply }).await()
  const locale = ctx.get('locale') as LocaleRuntime
  locale.register('settings.pluginInventory', 'en', enSettingsPluginInventory)
  locale.register('settings.pluginInventory', 'zh', zhSettingsPluginInventory)
  const ruFiber = ctx.plugin({ inject: [...inject], apply })
  await ruFiber.await()
  return { ctx, locale, ruFiber }
}

describe('Strata package manifests, centralized Russian plugin metadata catalog, and sandbox escalation copy', () => {
  it('ships valid en, zh, and ru manifest dictionaries and publishable files entries across all @strata/* packages', () => {
    hostApply()
    const strataPackages = ['product-bundle', 'ui-brand', 'locale-ru'] as const

    for (const pkg of strataPackages) {
      const pkgDir = join(REPO_ROOT, 'packages', 'strata', pkg)
      const manifest = readPackageManifest(join(pkgDir, 'package.json'))
      expect(
        filesCoverRuLocale(manifest.files),
        `${manifest.name ?? pkg} package.json "files" must include locale/ru.json`,
      ).toBe(true)

      const enMeta = readLocaleMeta(join(pkgDir, 'locale', 'en.json')).meta
      const zhMeta = readLocaleMeta(join(pkgDir, 'locale', 'zh.json')).meta
      const ruPath = join(pkgDir, 'locale', 'ru.json')
      expect(existsSync(ruPath), `${pkg}/locale/ru.json must exist`).toBe(true)
      const ruMeta = readLocaleMeta(ruPath).meta

      for (const field of ['title', 'description'] as const) {
        expect(typeof enMeta?.[field], `${pkg} en.${field}`).toBe('string')
        expect(enMeta![field]!.length).toBeGreaterThan(0)
        expect(typeof zhMeta?.[field], `${pkg} zh.${field}`).toBe('string')
        expect(zhMeta![field]!.length).toBeGreaterThan(0)
        expect(typeof ruMeta?.[field], `${pkg} ru.${field}`).toBe('string')
        expect(ruMeta![field]!.length).toBeGreaterThan(0)
        expect(ruMeta![field]).toMatch(/[А-Яа-яЁё]/)
        expect(ruMeta![field]).not.toBe(enMeta![field])
        expect(ruMeta![field]).not.toBe(zhMeta![field])
      }
    }
  })

  it('covers 100% of built-in plugin titles/descriptions and official on-demand bundle cards in Russian', async () => {
    const builtInPlugins = discoverBuiltInPluginMetadata()
    const officialBundles = await discoverOfficialBundleMetadata()

    expect(builtInPlugins.length).toBeGreaterThanOrEqual(230)
    expect(officialBundles.length).toBeGreaterThanOrEqual(2)

    const boot = await bootLocaleWithRu()
    try {
      expect(boot.locale.getLocale().active).toBe('ru')

      const missing: string[] = []
      for (const item of [...builtInPlugins, ...officialBundles]) {
        for (const field of ['title', 'description'] as const) {
          const record = item[field]
          if (record === undefined) continue

          const resolved = boot.locale.resolveText(record)
          const hasDirectRu = record.ru !== undefined
          const hasCatalogRu = Object.hasOwn(ruPluginMetadataCatalog, record.en)

          if (!hasDirectRu && !hasCatalogRu) {
            missing.push(`${item.source} (${field}): ${JSON.stringify(record.en)}`)
            continue
          }

          if (!INTENTIONAL_LATIN_TITLES.has(record.en) && !/[А-Яа-яЁё]/.test(resolved)) {
            missing.push(`${item.source} (${field}) lacks Cyrillic: ${JSON.stringify(resolved)}`)
          }
        }
      }

      expect(missing).toEqual([])
      expect(boot.locale.resolveText({ en: 'timer', zh: '计时服务' })).toBe('Таймер')
      expect(boot.locale.resolveText({ en: 'Claude Code subagent', zh: 'Claude Code 子智能体' }))
        .toMatch(/[А-Яа-яЁё]/)
      expect(boot.locale.resolveText({ en: 'Codex subagent', zh: 'Codex 子智能体' }))
        .toMatch(/[А-Яа-яЁё]/)
    } finally {
      await boot.ctx.fiber.dispose()
    }
  })

  it('renders and filters Built-in Plugins cards by their Russian catalog titles and descriptions', async () => {
    const boot = await bootLocaleWithRu()
    try {
      type Snapshot = Awaited<ReturnType<PluginInventorySettingsTabInjected['list']>>
      const snapshot: Snapshot = {
        entries: [],
        agentPresets: [
          {
            id: 'strata',
            isDefault: true,
            rows: [
              {
                moduleName: '@deepseek-ai/cordis-plugin-timer',
                entryId: null,
                enabled: true,
                fiberPhase: 'active',
                meta: {
                  title: { en: 'timer', zh: '计时服务' },
                  description: { en: 'Timer service for cordis', zh: '为插件提供延迟与周期任务调度。' },
                },
              },
              {
                moduleName: '@deepseek-ai/dsh-time-context',
                entryId: null,
                enabled: true,
                fiberPhase: 'active',
                meta: {
                  title: { en: 'Time awareness', zh: '时间感知' },
                  description: {
                    en: "Tells the model the current time, the browser's time zone, and the time since the previous message at each step.",
                    zh: '每一步把当前时间、浏览器时区和距上一条消息的时长告诉模型。',
                  },
                },
              },
              {
                moduleName: '@deepseek-ai/dsh-mcp-client',
                entryId: null,
                enabled: true,
                fiberPhase: 'active',
                meta: {
                  title: '@deepseek-ai/dsh-mcp-client',
                  description: 'MCP client bridge: connects to MCP servers and registers their tools on ctx.tools',
                },
              },
              {
                moduleName: 'acme-custom-plugin',
                entryId: null,
                enabled: true,
                fiberPhase: 'active',
                meta: {
                  title: { en: 'Acme Custom Inspector' },
                  description: { en: 'User-installed external plugin description.' },
                },
              },
            ],
          },
        ],
      }

      const clientSyncStore = createSnapshotStore({
        syncing: false,
        failures: [] as readonly { readonly id: string; readonly message: string }[],
      })
      const tabProps = {
        t: boot.locale.bind('settings.pluginInventory'),
        list: async () => snapshot,
        presetName: preset => preset.name ?? preset.id,
        resolveText: text => boot.locale.resolveText(text),
        useClientSync: bindSnapshotSelector(clientSyncStore),
        retryClient: () => {},
      } as PluginInventorySettingsTabProps

      render(createElement(PluginInventorySettingsTab, tabProps))

      const searchInput = await waitFor(() => screen.getByRole('searchbox'))
      fireEvent.change(searchInput, { target: { value: 'Таймер' } })

      await waitFor(() => {
        expect(screen.getByText('Таймер')).toBeTruthy()
      })
      expect(screen.queryByText('Acme Custom Inspector')).toBeNull()

      fireEvent.change(searchInput, { target: { value: 'Клиент MCP' } })
      await waitFor(() => {
        expect(screen.getByText('Клиент MCP')).toBeTruthy()
      })
      expect(screen.queryByText('Таймер')).toBeNull()

      fireEvent.change(searchInput, { target: { value: 'Acme Custom' } })
      await waitFor(() => {
        expect(screen.getByText('Acme Custom Inspector')).toBeTruthy()
      })
      expect(screen.queryByText('Таймер')).toBeNull()
    } finally {
      await boot.ctx.fiber.dispose()
    }
  })

  it('enforces priority order under active ru: explicit text.ru > catalog translation > untouched custom copy, and unwinds on disposal', async () => {
    const boot = await bootLocaleWithRu()
    try {
      expect(boot.locale.getLocale().active).toBe('ru')

      // 1. Package-provided text.ru takes precedence over the centralized catalog.
      const withOwnRu = {
        en: 'Time awareness',
        zh: '时间感知',
        ru: 'Собственный перевод стороннего пакета',
      }
      expect(boot.locale.resolveText(withOwnRu)).toBe('Собственный перевод стороннего пакета')

      // 2. Unmodified built-in LocalizedText resolves via the centralized Russian catalog.
      const builtInText = {
        en: 'Time awareness',
        zh: '时间感知',
      }
      const catalogTranslation = boot.locale.resolveText(builtInText)
      expect(catalogTranslation).toBe(ruPluginMetadataCatalog['Time awareness'])
      expect(catalogTranslation).toMatch(/[А-Яа-яЁё]/)
      expect(catalogTranslation).not.toBe('Собственный перевод стороннего пакета')

      // 3. User-modified or third-party LocalizedText and bare strings remain intact.
      expect(boot.locale.resolveText({ en: 'Custom user-edited preset description' }))
        .toBe('Custom user-edited preset description')
      expect(boot.locale.resolveText('Literal user-authored title'))
        .toBe('Literal user-authored title')

      // 4. Disposing @strata/locale-ru removes the catalog while keeping built-in ru active and falling back to English metadata.
      await boot.ruFiber.dispose()
      expect(boot.locale.getLocale().active).toBe('ru')
      expect(boot.locale.resolveText(builtInText)).toBe('Time awareness')
    } finally {
      await boot.ctx.fiber.dispose()
    }
  })

  it('localizes sandbox escalation and auto-review displayReason prompts in Russian with mode and justification interpolation', async () => {
    const escalationSource = readFileSync(
      join(REPO_ROOT, 'packages', 'sandbox', 'sandbox', 'src', 'locales.ts'),
      'utf8',
    )
    const autoReviewSource = readFileSync(
      join(REPO_ROOT, 'packages', 'experimental', 'auto-review', 'src', 'locales.ts'),
      'utf8',
    )

    expect(escalationSource).toContain('`Разрешить эту операцию с правами ${mode}: ${justification}`')
    expect(autoReviewSource).toContain("denied: 'Автопроверка отклонила этот вызов.'")
    expect(autoReviewSource).toContain('`Автопроверка отклонила этот вызов: ${reason}`')

    const boot = await bootLocaleWithRu()
    try {
      const mode = 'workspace-write'
      const justification = 'требуется запись файла конфигурации'
      const escalationReason = {
        ru: `Разрешить эту операцию с правами ${mode}: ${justification}`,
        en: `Allow this operation with ${mode} permissions: ${justification}`,
        zh: `允许本次操作使用 ${mode} 权限：${justification}`,
      }
      const denialPlain = {
        ru: 'Автопроверка отклонила этот вызов.',
        en: 'Auto review denied this call.',
        zh: 'Auto review 拒绝了此调用。',
      }
      const denialWithReason = {
        ru: 'Автопроверка отклонила этот вызов: подозрительный сетевой вызов',
        en: 'Auto review denied this call: подозрительный сетевой вызов',
        zh: 'Auto review 拒绝了此调用：подозрительный сетевой вызов',
      }

      expect(boot.locale.resolveText(escalationReason))
        .toBe('Разрешить эту операцию с правами workspace-write: требуется запись файла конфигурации')
      expect(boot.locale.resolveText(denialPlain))
        .toBe('Автопроверка отклонила этот вызов.')
      expect(boot.locale.resolveText(denialWithReason))
        .toBe('Автопроверка отклонила этот вызов: подозрительный сетевой вызов')

      boot.locale.setLocale('en')
      expect(boot.locale.resolveText(escalationReason))
        .toBe('Allow this operation with workspace-write permissions: требуется запись файла конфигурации')
    } finally {
      await boot.ctx.fiber.dispose()
    }
  })
})
