// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import {
  isBuiltInPreset,
  presetDisplayText,
} from '@deepseek-ai/dsh-agent-preset-registry/display'
import {
  apply as localeApply,
  inject as localeInject,
  type LocaleRuntime,
} from '@deepseek-ai/dsh-client-locale/client'
import { LOCALE_CONFIG_GLOBAL } from '@deepseek-ai/dsh-client-locale/src/locale-settings.ts'
import {
  en as enAccountNotifications,
  zh as zhAccountNotifications,
} from '@deepseek-ai/dsh-client-ui-account-notifications/src/client/locales.ts'
import {
  en as enAgentPreset,
  zh as zhAgentPreset,
} from '@deepseek-ai/dsh-client-ui-agent-preset/src/client/locales.ts'
import {
  en as enCommand,
  zh as zhCommand,
} from '@deepseek-ai/dsh-client-ui-commands/src/client/locales.ts'
import { dictionaries as contextMenuDictionaries } from '@deepseek-ai/dsh-client-ui-context-menu/src/client/locales.ts'
import {
  en as enEntryCustomization,
  zh as zhEntryCustomization,
} from '@deepseek-ai/dsh-client-ui-entry-customization/src/client/locales.ts'
import {
  en as enFileActions,
  zh as zhFileActions,
} from '@deepseek-ai/dsh-client-ui-file-actions/src/client/locales.ts'
import {
  en as enFileDrag,
  zh as zhFileDrag,
} from '@deepseek-ai/dsh-client-ui-file-drag/src/client/locales.ts'
import {
  en as enShortcutsLayout,
  zh as zhShortcutsLayout,
} from '@deepseek-ai/dsh-client-ui-layout/src/client/shortcut-locales.ts'
import {
  en as enModel,
  zh as zhModel,
} from '@deepseek-ai/dsh-client-ui-model-selection/src/client/locales.ts'
import {
  en as enOpenInApp,
  zh as zhOpenInApp,
} from '@deepseek-ai/dsh-client-ui-open-in-app/src/client/locales.ts'
import {
  accessEn as enPermissionAccess,
  accessZh as zhPermissionAccess,
  en as enSettingsPermission,
  zh as zhSettingsPermission,
} from '@deepseek-ai/dsh-client-ui-permission-presets/src/client/locales.ts'
import {
  en as enPluginManager,
  zh as zhPluginManager,
} from '@deepseek-ai/dsh-client-ui-plugin-manager/src/client/locales.ts'
import {
  en as enPluginMarket,
  zh as zhPluginMarket,
} from '@deepseek-ai/dsh-client-ui-plugin-market/src/client/locales.ts'
import {
  en as enSecretMask,
  zh as zhSecretMask,
} from '@deepseek-ai/dsh-client-ui-secret-mask/src/client/locales.ts'
import {
  en as enSettingsAccount,
  zh as zhSettingsAccount,
} from '@deepseek-ai/dsh-client-ui-settings-account/src/client/locales.ts'
import {
  en as enSettingsAgentLoop,
  zh as zhSettingsAgentLoop,
} from '@deepseek-ai/dsh-client-ui-settings-agent-loop/src/client/locales.ts'
import {
  en as enSettings,
  zh as zhSettings,
} from '@deepseek-ai/dsh-client-ui-settings-general/src/client/locales.ts'
import {
  en as enSettingsModels,
  zh as zhSettingsModels,
} from '@deepseek-ai/dsh-client-ui-settings-models/src/client/locales.ts'
import {
  en as enSettingsPluginInventory,
  zh as zhSettingsPluginInventory,
} from '@deepseek-ai/dsh-client-ui-settings-plugin-inventory/src/client/locales.ts'
import {
  en as enSettingsPlugins,
  zh as zhSettingsPlugins,
} from '@deepseek-ai/dsh-client-ui-settings-plugins/src/client/locales.ts'
import {
  en as enSettingsSessionLog,
  zh as zhSettingsSessionLog,
} from '@deepseek-ai/dsh-client-ui-settings-session-log/src/client/locales.ts'
import {
  en as enSettingsShell,
  zh as zhSettingsShell,
} from '@deepseek-ai/dsh-client-ui-settings-shell/src/client/locales.ts'
import {
  en as enSettingsSubagent,
  zh as zhSettingsSubagent,
} from '@deepseek-ai/dsh-client-ui-settings-subagent/src/client/locales.ts'
import {
  en as enSettingsWebSearch,
  zh as zhSettingsWebSearch,
} from '@deepseek-ai/dsh-client-ui-settings-web-search/src/client/locales.ts'
import {
  en as enShortcuts,
  zh as zhShortcuts,
} from '@deepseek-ai/dsh-client-ui-shortcuts/src/client/locales.ts'
import {
  en as enSidebar,
  zh as zhSidebar,
} from '@deepseek-ai/dsh-client-ui-sidebar/src/client/locales.ts'
import {
  en as enSidebarRight,
  zh as zhSidebarRight,
} from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/locales.ts'
import {
  en as enSettingsTheme,
  zh as zhSettingsTheme,
} from '@deepseek-ai/dsh-client-ui-theme/src/client/locales.ts'
import {
  en as enWorkspace,
  zh as zhWorkspace,
} from '@deepseek-ai/dsh-client-ui-workspace/src/client/locales.ts'
import {
  en as enMessageQuotes,
  zh as zhMessageQuotes,
} from '@deepseek-ai/dsh-message-quotes/src/client/locales.ts'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { ruSettingsAgentPreset } from '../src/client/locales/agent-preset.ts'
import {
  ruAccountNotifications,
  ruContextMenu,
  ruFileActions,
  ruFileDrag,
  ruMessageQuotes,
} from '../src/client/locales/client-ui.ts'
import {
  ruModel,
  ruSettingsModels,
} from '../src/client/locales/models.ts'
import {
  ruCommand,
  ruDirectoryBrowser,
  ruOpenInApp,
  ruPermissionAccess,
  ruShortcuts,
  ruShortcutsLayout,
  ruSidebar,
  ruSidebarRight,
  ruWorkspace,
} from '../src/client/locales/navigation.ts'
import {
  ruEntryCustomization,
  ruPluginManager,
  ruPluginMarket,
  ruSettingsPluginInventory,
} from '../src/client/locales/plugins.ts'
import {
  ruSecretMask,
  ruSettings,
  ruSettingsAccount,
  ruSettingsAgentLoop,
  ruSettingsPermission,
  ruSettingsPlugins,
  ruSettingsSessionLog,
  ruSettingsShell,
  ruSettingsSubagent,
  ruSettingsTheme,
  ruSettingsWebSearch,
} from '../src/client/locales/settings.ts'

const EN_DIRECTORY_BROWSER: Record<string, string> = {
  'browser.title': 'Select Workspace Directory',
  'browser.home': 'Home',
  'browser.newFolder': 'New folder',
  'browser.folderName': 'Folder name',
  'browser.createIn': 'New folder in "{name}"',
  'browser.untitledFolder': 'Untitled folder',
  'browser.create': 'Create',
  'browser.cancel': 'Cancel',
  'browser.open': 'Open',
  'browser.editPath': 'Edit path',
  'browser.loading': 'Loading…',
  'browser.truncated': 'Too many folders to list; only the beginning is shown.',
  'browser.showHidden': 'Show hidden files',
}

interface NamespaceSpec {
  readonly ns: string
  readonly ru: Record<string, string>
  readonly en: Record<string, string>
  readonly zh?: Record<string, string>
}

const NAMESPACE_SPECS: readonly NamespaceSpec[] = [
  { ns: 'settings', ru: ruSettings, en: enSettings, zh: zhSettings },
  { ns: 'settings.theme', ru: ruSettingsTheme, en: enSettingsTheme, zh: zhSettingsTheme },
  { ns: 'settings.models', ru: ruSettingsModels, en: enSettingsModels, zh: zhSettingsModels },
  { ns: 'settings.account', ru: ruSettingsAccount, en: enSettingsAccount, zh: zhSettingsAccount },
  { ns: 'settings.agentLoop', ru: ruSettingsAgentLoop, en: enSettingsAgentLoop, zh: zhSettingsAgentLoop },
  { ns: 'settings.pluginInventory', ru: ruSettingsPluginInventory, en: enSettingsPluginInventory, zh: zhSettingsPluginInventory },
  { ns: 'settings.sessionLog', ru: ruSettingsSessionLog, en: enSettingsSessionLog, zh: zhSettingsSessionLog },
  { ns: 'settings.shell', ru: ruSettingsShell, en: enSettingsShell, zh: zhSettingsShell },
  { ns: 'settings.subagent', ru: ruSettingsSubagent, en: enSettingsSubagent, zh: zhSettingsSubagent },
  { ns: 'settings.webSearch', ru: ruSettingsWebSearch, en: enSettingsWebSearch, zh: zhSettingsWebSearch },
  { ns: 'settings.agentPreset', ru: ruSettingsAgentPreset, en: enAgentPreset, zh: zhAgentPreset },
  { ns: 'settings.permission', ru: ruSettingsPermission, en: enSettingsPermission, zh: zhSettingsPermission },
  { ns: 'settings.plugins', ru: ruSettingsPlugins, en: enSettingsPlugins, zh: zhSettingsPlugins },
  { ns: 'pluginManager', ru: ruPluginManager, en: enPluginManager, zh: zhPluginManager },
  { ns: 'pluginMarket', ru: ruPluginMarket, en: enPluginMarket, zh: zhPluginMarket },
  { ns: 'entryCustomization', ru: ruEntryCustomization, en: enEntryCustomization, zh: zhEntryCustomization },
  { ns: 'secretMask', ru: ruSecretMask, en: enSecretMask, zh: zhSecretMask },
  { ns: 'sidebar', ru: ruSidebar, en: enSidebar, zh: zhSidebar },
  { ns: 'sidebarRight', ru: ruSidebarRight, en: enSidebarRight, zh: zhSidebarRight },
  { ns: 'workspace', ru: ruWorkspace, en: enWorkspace, zh: zhWorkspace },
  { ns: 'directory-browser', ru: ruDirectoryBrowser, en: EN_DIRECTORY_BROWSER },
  { ns: 'shortcuts', ru: ruShortcuts, en: enShortcuts, zh: zhShortcuts },
  { ns: 'shortcuts.layout', ru: ruShortcutsLayout, en: enShortcutsLayout, zh: zhShortcutsLayout },
  { ns: 'command', ru: ruCommand, en: enCommand, zh: zhCommand },
  { ns: 'open-in-app', ru: ruOpenInApp, en: enOpenInApp, zh: zhOpenInApp },
  { ns: 'permission.access', ru: ruPermissionAccess, en: enPermissionAccess, zh: zhPermissionAccess },
  { ns: 'model', ru: ruModel, en: enModel, zh: zhModel },
  { ns: 'account.notifications', ru: ruAccountNotifications, en: enAccountNotifications, zh: zhAccountNotifications },
  { ns: 'contextMenu', ru: ruContextMenu, en: contextMenuDictionaries.en, zh: contextMenuDictionaries.zh },
  { ns: 'fileActions', ru: ruFileActions, en: enFileActions, zh: zhFileActions },
  { ns: 'fileDrag', ru: ruFileDrag, en: enFileDrag, zh: zhFileDrag },
  { ns: 'messageQuotes', ru: ruMessageQuotes, en: enMessageQuotes, zh: zhMessageQuotes },
]

function extractPlaceholders(template: string): string[] {
  const names = new Set<string>()
  const pattern = /\{([a-zA-Z0-9_]+)(?:\s*,\s*plural\s*,|\})/g
  for (const match of template.matchAll(pattern)) {
    names.add(match[1]!)
  }
  return [...names].sort()
}

afterEach(() => {
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
  for (const spec of NAMESPACE_SPECS) {
    if (spec.zh !== undefined) {
      locale.register(spec.ns, 'zh', spec.zh)
    }
    locale.register(spec.ns, 'en', spec.en)
  }
  const ruFiber = ctx.plugin({ inject: [...inject], apply })
  await ruFiber.await()
  return { ctx, locale, ruFiber }
}

describe('Settings, navigation, plugin management, and Strata presets in @strata/locale-ru', () => {
  it.each(NAMESPACE_SPECS)('maintains 100% key and placeholder parity for $ns', ({ ru, en }) => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort())

    for (const [key, enText] of Object.entries(en)) {
      const ruText = ru[key]
      expect(typeof ruText, `${key} should be a string`).toBe('string')
      expect(ruText!.length, `${key} should not be empty`).toBeGreaterThan(0)
      expect(extractPlaceholders(ruText!), `${key} placeholders`).toEqual(extractPlaceholders(enText))
    }
  })

  it('registers all 32 settings, navigation, plugin, and client UI namespaces into ctx.locale and falls back cleanly on unload', async () => {
    expect(NAMESPACE_SPECS).toHaveLength(32)
    const boot = await bootLocaleWithRu()
    try {
      expect(boot.locale.getLocale().active).toBe('ru')

      for (const spec of NAMESPACE_SPECS) {
        const t = boot.locale.bind(spec.ns)
        const firstKey = Object.keys(spec.en)[0]!
        expect(t(firstKey, {
          app: 'VS Code',
          command: 'settings',
          count: 2,
          label: 'Strata',
          market: 'Official',
          model: 'deepseek-chat',
          n: 2,
          name: 'Workspace',
          provider: 'DeepSeek',
          version: '1.0.0',
        })).not.toBe(firstKey)
      }

      // Unmount @strata/locale-ru and confirm fallback to English without raw keys.
      await boot.ruFiber.dispose()
      expect(boot.locale.getLocale().active).toBe('ru')
      expect(boot.locale.bind('settings')('title')).toBe('Settings')
      expect(boot.locale.bind('sidebar')('session.new')).toBe('New Session')
      expect(boot.locale.bind('settings.plugins')('nav')).toBe('Built-in plugins')
    } finally {
      await boot.ctx.fiber.dispose()
    }
  })

  it('enforces canonical StrataHarness Russian product terminology and slash-command token invariants', () => {
    expect(ruSidebar['session.new']).toBe('Новая сессия')
    expect(ruSidebar['panels.more']).toBe('Ещё')

    expect(ruWorkspace['section.workspaces']).toBe('Рабочие области')
    expect(ruWorkspace['section.sessions']).toBe('Сессии')
    expect(ruWorkspace['workspace.add']).toBe('Добавить рабочую область')

    expect(ruSettings['title']).toBe('Настройки')
    expect(ruSettings['general.nav']).toBe('Общие')
    expect(ruSettingsModels['nav']).toBe('Модели')
    expect(ruSettingsAgentPreset['nav']).toBe('Пресеты агентов')
    expect(ruSettingsAgentPreset['builtInGroup']).toBe('Встроенные')
    expect(ruSettingsAgentPreset['customGroup']).toBe('Пользовательские')
    expect(ruSettingsPlugins['nav']).toBe('Встроенные плагины')
    expect(ruSettingsPlugins['title']).toBe('Встроенные плагины')
    expect(ruPluginManager['panel']).toBe('Плагины')
    expect(ruPluginManager['title']).toBe('Плагины')

    expect(ruSettingsTheme['appearance.title']).toBe('Оформление')
    expect(ruSettingsTheme['appearance.light']).toBe('Светлая')
    expect(ruSettingsTheme['appearance.dark']).toBe('Тёмная')
    expect(ruSettingsTheme['appearance.system']).toBe('Системная')

    expect(ruSettingsPermission['preset.readOnly']).toBe('Только чтение')
    expect(ruSettingsPermission['preset.workspaceWrite']).toBe('Запись в рабочую область')
    expect(ruSettingsPermission['preset.fullAccess']).toBe('Полный доступ')
    expect(ruPermissionAccess['preset.readOnly']).toBe('Только чтение')
    expect(ruPermissionAccess['preset.workspaceWrite']).toBe('Запись в рабочую область')
    expect(ruPermissionAccess['preset.fullAccess']).toBe('Полный доступ')

    expect(ruShortcuts['title']).toBe('Горячие клавиши')
    expect(ruShortcuts['settings']).toBe('Горячие клавиши')

    expect(ruSettingsAccount['onboardingSkipDescription']).toContain('Подробности работы')
    expect(ruSettingsAccount['onboardingSkipDescription']).toContain('Настройки → Общие')

    // Slash command claim tokens inserted into the composer must remain canonical ASCII command names.
    for (const cmd of ['goal', 'plan', 'feedback', 'compact', 'permission', 'export'] as const) {
      expect(ruCommand[`token.${cmd}`]).toBe(cmd)
      expect(ruCommand[`label.${cmd}`]).not.toBe(enCommand[`label.${cmd}`])
    }
  })

  it('formats Russian plural counters accurately across one (1, 21), few (2), and many (5)', async () => {
    const boot = await bootLocaleWithRu()
    try {
      const tWorkspace = boot.locale.bind('workspace')
      expect(tWorkspace('sessions.count.one', { n: 1 })).toBe('1 сессия')
      expect(tWorkspace('sessions.count.other', { n: 2 })).toBe('2 сессии')
      expect(tWorkspace('sessions.count.other', { n: 5 })).toBe('5 сессий')
      expect(tWorkspace('sessions.count.other', { n: 21 })).toBe('21 сессия')

      expect(tWorkspace('status.subagentsRunning.one', { n: 1 })).toBe('1 активный субагент')
      expect(tWorkspace('status.subagentsRunning.other', { n: 2 })).toBe('2 активных субагента')
      expect(tWorkspace('status.subagentsRunning.other', { n: 5 })).toBe('5 активных субагентов')
      expect(tWorkspace('status.subagentsRunning.other', { n: 21 })).toBe('21 активный субагент')

      expect(tWorkspace('sessions.expand', { n: 1 })).toBe('Показать ещё 1 сессию')
      expect(tWorkspace('sessions.expand', { n: 2 })).toBe('Показать ещё 2 сессии')
      expect(tWorkspace('sessions.expand', { n: 5 })).toBe('Показать ещё 5 сессий')
      expect(tWorkspace('sessions.expand', { n: 21 })).toBe('Показать ещё 21 сессию')

      const tInventory = boot.locale.bind('settings.pluginInventory')
      expect(tInventory('matchesInOtherPresets', { count: 1 })).toBe('Ещё 1 совпадение в других пресетах: ')
      expect(tInventory('matchesInOtherPresets', { count: 2 })).toBe('Ещё 2 совпадения в других пресетах: ')
      expect(tInventory('matchesInOtherPresets', { count: 5 })).toBe('Ещё 5 совпадений в других пресетах: ')
      expect(tInventory('matchesInOtherPresets', { count: 21 })).toBe('Ещё 21 совпадение в других пресетах: ')

      const tPlugins = boot.locale.bind('pluginManager')
      expect(tPlugins('terminalExpand', { n: 1 })).toBe('… ещё 1 строка')
      expect(tPlugins('terminalExpand', { n: 2 })).toBe('… ещё 2 строки')
      expect(tPlugins('terminalExpand', { n: 5 })).toBe('… ещё 5 строк')
      expect(tPlugins('terminalExpand', { n: 21 })).toBe('… ещё 21 строка')

      const tShortcuts = boot.locale.bind('shortcuts')
      expect(tShortcuts('modified-count', { count: 1 })).toBe('Изменено: 1')
      expect(tShortcuts('modified-count', { count: 5 })).toBe('Изменено: 5')
    } finally {
      await boot.ctx.fiber.dispose()
    }
  })

  it('resolves the Strata and built-in presets in ru, en, and zh, shortens inUse, and keeps product-bundle YAML prompts in English', async () => {
    const boot = await bootLocaleWithRu()
    try {
      const tPreset = boot.locale.bind('settings.agentPreset')
      boot.locale.setLocale('ru')
      expect(tPreset('inUse')).toBe('По умолчанию')

      expect(isBuiltInPreset({ id: 'strata' })).toBe(true)
      expect(existsSync(resolve(import.meta.dirname, '..', '..', 'product-bundle', 'presets', 'strata.patch.yml'))).toBe(false)

      const roles = [
        { id: 'strata-developer', name: 'Strata Developer', file: 'strata-developer.patch.yml', promptHeader: 'You are **Strata Developer**' },
        { id: 'strata-analyst', name: 'Strata Analyst', file: 'strata-analyst.patch.yml', promptHeader: 'You are **Strata Analyst**' },
        { id: 'strata-designer', name: 'Strata Designer', file: 'strata-designer.patch.yml', promptHeader: 'You are **Strata Designer**' },
        { id: 'standard', name: undefined, file: 'standard.patch.yml', promptHeader: 'You are a coding agent powered by the {{model}} model.' },
        { id: 'ptc', name: undefined, file: 'ptc.patch.yml', promptHeader: 'You are a coding agent powered by the {{model}} model.' },
        { id: 'cordis', name: undefined, file: 'cordis.patch.yml', promptHeader: 'You are a coding agent powered by the {{model}} model.' },
      ] as const

      for (const role of roles) {
        expect(isBuiltInPreset({ id: role.id })).toBe(true)

        boot.locale.setLocale('ru')
        const ruCopy = presetDisplayText({ id: role.id }, key => tPreset(key))
        if (role.name !== undefined) expect(ruCopy.name).toBe(role.name)
        expect(ruCopy.description).toMatch(/[А-Яа-яЁё]/)

        boot.locale.setLocale('en')
        const enCopy = presetDisplayText({ id: role.id }, key => tPreset(key))
        if (role.name !== undefined) expect(enCopy.name).toBe(role.name)
        expect(enCopy.description).not.toBe(ruCopy.description)

        boot.locale.setLocale('zh')
        const zhCopy = presetDisplayText({ id: role.id }, key => tPreset(key))
        if (role.name !== undefined) expect(zhCopy.name).toBe(role.name)
        expect(zhCopy.description).not.toBe(enCopy.description)
        expect(zhCopy.description).not.toBe(ruCopy.description)

        const yamlPath = resolve(import.meta.dirname, '..', '..', 'product-bundle', 'presets', role.file)
        const yamlText = readFileSync(yamlPath, 'utf8')
        const configBeforePlugins = yamlText.split('config:')[1]!.split('plugins:')[0]!
        expect(configBeforePlugins).toContain(`id: ${role.id}`)
        expect(configBeforePlugins).not.toMatch(/^\s+name:/m)
        expect(configBeforePlugins).not.toMatch(/^\s+description:/m)
        expect(yamlText).toContain(role.promptHeader)
      }
    } finally {
      await boot.ctx.fiber.dispose()
    }
  })
})
