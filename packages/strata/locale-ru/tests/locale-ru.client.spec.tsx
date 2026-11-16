// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import {
  COMMON_NS,
  SETTINGS_NS,
  apply as localeApply,
  inject as localeInject,
  type LanguageRowComponentProps,
  type LanguageRowInjected,
  type LocaleRuntime,
} from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { TestRemote, allowAllAccess, bindSnapshotSelector, contextMenuHook } from '@deepseek-ai/dsh-client-test-runtime'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LanguageRow } from '@deepseek-ai/dsh-client-locale/src/client/LanguageRow.tsx'
import type { createLanguageRowStore } from '@deepseek-ai/dsh-client-locale/src/client/settings-store.ts'
import {
  LOCALE_CONFIG_GLOBAL,
  LOCALE_SETTINGS_NAMESPACE,
  LocaleSettingsSchema,
} from '@deepseek-ai/dsh-client-locale/src/locale-settings.ts'
import { en as enCommon } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

const SLOT = 'settings.general.item'
const useResource = (() => ({
  status: 'none' as const,
  value: undefined,
  failure: undefined,
  reload: () => {},
})) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })
type AttentionSnapshot = Parameters<Parameters<LanguageRowComponentProps['useSessionStatus']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionStatus: LanguageRowComponentProps['useSessionStatus'] = selector => selector(noAttention)

function emptySessions() {
  const store = createSnapshotStore<SessionListState>({
    ids: [],
    byId: {},
    phase: 'ready',
    projectionsBySession: {},
  })
  return bindSnapshotSelector(store)
}

function emptyWorkspaces() {
  const store = createSnapshotStore<WorkspaceSnapshot>({
    items: [],
    archivedSessionIds: [],
    pinnedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
  })
  return bindSnapshotSelector(store)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function bootProductLocale(initialPreference?: string) {
  document.documentElement.lang = 'en'
  vi.stubGlobal('navigator', { languages: ['en-US', 'zh-CN'], language: 'en-US' })
  vi.stubGlobal(LOCALE_CONFIG_GLOBAL, {
    defaultLocale: 'ru',
    localeOrder: ['ru', 'en', 'zh'],
  })
  let storedPreference = initialPreference
  let revision = 0
  const onChange = vi.fn()
  vi.stubGlobal('__DSH_LOCALE__', {
    read: async () => ({
      languages: ['en-US', 'zh-CN'],
      preference: storedPreference ?? null,
    }),
    onChange,
  })

  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register(
    { name: 'root', children: { [SLOT]: { kind: 'list', scope: 'root' } } } as never,
    () => null,
  )

  const namespace = () => ({
    ns: LOCALE_SETTINGS_NAMESPACE,
    schema: LocaleSettingsSchema.toJSON(),
    value: storedPreference === undefined ? {} : { preference: storedPreference },
    autoGenerate: false,
    applies: 'live' as const,
    secrets: [],
    revision,
  })
  const describeRpc = vi.fn(async () => ({
    ok: true as const,
    value: { writable: true, hasDocument: true, namespaces: [namespace()] },
  }))
  const mutate = vi.fn(async (_ns: string, ops: { value: string }[]) => {
    storedPreference = ops[0]!.value
    revision += 1
    return { ok: true as const, value: namespace() }
  })
  new TestRemote(ctx, { settings: { describe: describeRpc, mutate } })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  await ctx.plugin({ inject: [...localeInject], apply: localeApply }).await()
  const ruFiber = ctx.plugin({ inject: [...inject], apply })
  await ruFiber.await()

  const locale = ctx.get('locale') as LocaleRuntime
  return {
    ctx,
    slots,
    locale,
    ruFiber,
    onChange,
    mutate,
    getStoredPreference: () => storedPreference,
  }
}

function mountRegisteredLanguageRow(slots: SlotRegistry, locale: LocaleRuntime) {
  const entry = slots.entries(SLOT).find(item => item.component === LanguageRow)!
  const handle = entry.store as ReturnType<typeof createLanguageRowStore>
  const instance = handle.create()
  const face = Reflect.apply(entry.inject!, undefined, [instance.actions]) as LanguageRowInjected
  const t = locale.bind(SETTINGS_NS)
  const renderView = () => (
    <LanguageRow
      useSessions={emptySessions()}
      useSessionStatus={useSessionStatus}
      usePanelInfo={usePanelInfo}
      useSessionRetainInfo={() => undefined}
      useResource={useResource}
      useWorkspaces={emptyWorkspaces()}
      {...allowAllAccess}
      useContextMenu={contextMenuHook()}
      useStore={bindSnapshotSelector(instance)}
      actions={instance.actions}
      t={t}
      setLocale={face.setLocale}
    />
  )
  const view = render(renderView())
  const unsubscribe = locale.subscribe(() => {
    view.rerender(renderView())
  })
  return { view, unsubscribe }
}

describe('StrataHarness Russian language pack (@strata/locale-ru)', () => {
  it('keeps the host Loader entry inert and declares Phase-1 immediate client activation', () => {
    expect(hostApply).not.toThrow()
    expect(inject).toEqual(['locale'])

    const productManifestPath = resolve(import.meta.dirname, '..', '..', '..', '..', 'strata-product.json')
    const productManifest = JSON.parse(readFileSync(productManifestPath, 'utf8')) as {
      productVersion: string
    }
    const manifestPath = resolve(import.meta.dirname, '..', 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      version: string
      dsh: { client: { immediately?: boolean; inject?: string[]; platform?: string } }
    }
    expect(manifest.version).toBe(productManifest.productVersion)
    expect(manifest.dsh.client).toEqual({
      inject: ['@deepseek-ai/dsh-client-locale'],
      platform: 'web',
      immediately: true,
    })
  })

  it('wires @strata/locale-ru and Russian locale defaults into @strata/product-bundle', () => {
    const bundleRoot = resolve(import.meta.dirname, '..', '..', 'product-bundle')
    const bundleManifest = JSON.parse(readFileSync(resolve(bundleRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(bundleManifest.dependencies['@strata/locale-ru']).toBe('workspace:~')

    const patch = readFileSync(resolve(bundleRoot, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain('- id: locale')
    expect(patch).toContain('defaultLocale: ru')
    expect(patch).toContain("name: '@strata/locale-ru'")
  })

  it('activates Russian by default, orders LanguageRow options [Русский, English, 中文], switches preference and __DSH_LOCALE__, and degrades cleanly on unload', async () => {
    const boot = await bootProductLocale()
    try {
      expect(boot.locale.getLocale().active).toBe('ru')
      expect(document.documentElement.lang).toBe('ru')
      expect(boot.onChange).toHaveBeenLastCalledWith('ru')
      expect(boot.locale.getLocale().locales.map(item => item.label)).toEqual([
        'Русский',
        'English',
        '中文',
        '日本語',
        'Español',
        'Français',
        'Deutsch',
        'Português',
      ])

      // Complete Russian coverage for `common` and `settings.locale`.
      const tCommon = boot.locale.bind(COMMON_NS)
      for (const key of Object.keys(enCommon) as (keyof typeof enCommon)[]) {
        const translated = tCommon(key, { action: 'Копировать', total: 100, value: 5 })
        expect(translated).not.toBe(key)
      }
      expect(boot.locale.bind(SETTINGS_NS)('language.title')).toBe('Язык')

      const mounted = mountRegisteredLanguageRow(boot.slots, boot.locale)
      try {
        expect(screen.getByText('Язык')).toBeDefined()
        const trigger = screen.getByRole('button', { name: /Русский/ })
        fireEvent.click(trigger)
        const items = screen.getAllByRole('menuitem')
        expect(items.map(item => item.textContent)).toEqual([
          'Русский',
          'English',
          '中文',
          '日本語',
          'Español',
          'Français',
          'Deutsch',
          'Português',
        ])

        // Switch to English through LanguageRow.
        fireEvent.click(screen.getByRole('menuitem', { name: 'English' }))
        expect(boot.locale.getLocale().active).toBe('en')
        expect(document.documentElement.lang).toBe('en')
        expect(boot.onChange).toHaveBeenLastCalledWith('en')
        await vi.waitFor(() => { expect(boot.getStoredPreference()).toBe('en') })
        expect(screen.getByText('Language')).toBeDefined()

        // Switch to Simplified Chinese, then back to Russian.
        fireEvent.click(screen.getByRole('button', { name: /English/ }))
        fireEvent.click(screen.getByRole('menuitem', { name: '中文' }))
        expect(boot.locale.getLocale().active).toBe('zh')
        expect(document.documentElement.lang).toBe('zh-CN')
        expect(boot.onChange).toHaveBeenLastCalledWith('zh')
        await vi.waitFor(() => { expect(boot.getStoredPreference()).toBe('zh') })

        fireEvent.click(screen.getByRole('button', { name: /中文/ }))
        fireEvent.click(screen.getByRole('menuitem', { name: 'Русский' }))
        expect(boot.locale.getLocale().active).toBe('ru')
        expect(document.documentElement.lang).toBe('ru')
        expect(boot.onChange).toHaveBeenLastCalledWith('ru')
        await vi.waitFor(() => { expect(boot.getStoredPreference()).toBe('ru') })

        // Unloading @strata/locale-ru peels back the Strata overlay onto the built-in 'ru' fallback without mutating stored 'ru'.
        expect(boot.locale.bind(COMMON_NS)('markdown.truncatedCharacters', { total: 5 }))
          .toBe('… обрезано (всего 5 символов)')
        const mutateCallsBeforeUnload = boot.mutate.mock.calls.length
        await boot.ruFiber.dispose()
        expect(boot.locale.getLocale().active).toBe('ru')
        expect(document.documentElement.lang).toBe('ru')
        expect(boot.locale.bind(SETTINGS_NS)('language.title')).toBe('Язык')
        expect(boot.locale.bind(COMMON_NS)('markdown.truncatedCharacters', { total: 5 }))
          .toBe('… обрезано до 5 символов')
        expect(screen.getByText('Язык')).toBeDefined()
        expect(boot.getStoredPreference()).toBe('ru')
        expect(boot.mutate).toHaveBeenCalledTimes(mutateCallsBeforeUnload)
      } finally {
        mounted.unsubscribe()
      }
    } finally {
      await boot.ctx.fiber.dispose()
    }
  })
})
