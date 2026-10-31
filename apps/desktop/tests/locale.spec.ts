import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'
import { STRATA_NSIS_INSTALLER_LANGUAGES } from '../scripts/strata-desktop-config.mjs'
import {
  desktopUpdateReadyConfirmation,
  en,
  formatDesktopAboutDetail,
  formatDesktopMessage,
  resolveDesktopLocale,
  resolveDesktopStartupLocale,
  ru,
  zh,
} from '../src/locale.ts'

describe('desktop locale dictionaries', () => {
  it('ships the identical 167-key set across Russian, English, and Chinese and serves Russian HTML shell lang tags', () => {
    expect(Object.keys(en)).toHaveLength(167)
    expect(Object.keys(ru)).toEqual(Object.keys(en))
    expect(Object.keys(zh)).toEqual(Object.keys(en))
    expect(ru.application).toBe('Приложение')
    expect(ru.edit).toBe('Правка')
    expect(ru.aboutMenu).toBe('О программе StrataHarness')
    expect(ru.startupFailed).toBe('StrataHarness недоступен')

    const htmlShellPaths = [
      resolve(import.meta.dirname, '..', '..', 'web', 'index.html'),
      resolve(import.meta.dirname, '..', 'renderer', 'welcome.html'),
      resolve(import.meta.dirname, '..', 'renderer', 'mandatory-update.html'),
      resolve(import.meta.dirname, '..', 'renderer', 'update-dialog.html'),
      resolve(import.meta.dirname, '..', 'renderer', 'policy-login-loading.html'),
    ]
    for (const htmlPath of htmlShellPaths) {
      expect(readFileSync(htmlPath, 'utf8'), htmlPath).toContain('<html lang="ru">')
    }
  })

  it('normalizes primary language tags and falls back to Russian for unknown or empty tags', () => {
    expect(resolveDesktopLocale('ru')).toEqual({ id: 'ru', messages: ru })
    expect(resolveDesktopLocale('ru-RU')).toEqual({ id: 'ru', messages: ru })
    expect(resolveDesktopLocale('ru_RU')).toEqual({ id: 'ru', messages: ru })
    expect(resolveDesktopLocale('en-US')).toEqual({ id: 'en', messages: en })
    expect(resolveDesktopLocale('en_GB')).toEqual({ id: 'en', messages: en })
    expect(resolveDesktopLocale('zh-Hans-CN')).toEqual({ id: 'zh-CN', messages: zh })
    expect(resolveDesktopLocale('zh_CN')).toEqual({ id: 'zh-CN', messages: zh })
    expect(resolveDesktopLocale('fr-FR')).toEqual({ id: 'ru', messages: ru })
    expect(resolveDesktopLocale('')).toEqual({ id: 'ru', messages: ru })
  })

  it('formats named values, Russian About details, and Russian update-ready confirmations', () => {
    expect(formatDesktopMessage('{name}@{version} {missing}', { name: 'plugin', version: '1.2.3' }))
      .toBe('plugin@1.2.3 {missing}')
    expect(formatDesktopAboutDetail(ru, '1.0.0', '0.2.1-rc.4'))
      .toBe('Версия V1.0.0\nДвижок: DSH 0.2.1-rc.4')
    expect(formatDesktopAboutDetail(ru, '1.0.0'))
      .toBe('Версия V1.0.0')
    expect(desktopUpdateReadyConfirmation(ru, '1.0.1', 'darwin')).toEqual({
      message: 'Версия 1.0.1 готова к установке',
      detail: ru.updateDownloadedDetail,
    })
    expect(desktopUpdateReadyConfirmation(ru, '1.0.1', 'win32')).toEqual({
      message: 'Версия 1.0.1 готова к установке',
      detail: ru.updateDownloadedDetailWindows,
    })
  })

  it('prefers an explicit supported choice and unconditionally defaults to Russian when unset or unrecognized', () => {
    expect(resolveDesktopStartupLocale(null, ['en-US', 'zh-CN'])).toEqual({ id: 'ru', messages: ru })
    expect(resolveDesktopStartupLocale(null, ['ja-JP', 'zh-Hant', 'en-US'])).toEqual({ id: 'ru', messages: ru })
    expect(resolveDesktopStartupLocale(null, [])).toEqual({ id: 'ru', messages: ru })
    expect(resolveDesktopStartupLocale('ru', ['en-US'])).toEqual({ id: 'ru', messages: ru })
    expect(resolveDesktopStartupLocale('ru-RU', ['en-US'])).toEqual({ id: 'ru', messages: ru })
    expect(resolveDesktopStartupLocale('EN', ['zh-CN'])).toEqual({ id: 'en', messages: en })
    expect(resolveDesktopStartupLocale('en-US', ['ru-RU'])).toEqual({ id: 'en', messages: en })
    expect(resolveDesktopStartupLocale('zh', ['en-US'])).toEqual({ id: 'zh-CN', messages: zh })
    expect(resolveDesktopStartupLocale('zh-CN', ['en-US'])).toEqual({ id: 'zh-CN', messages: zh })
    expect(resolveDesktopStartupLocale('fr', ['en-US', 'zh-CN'])).toEqual({ id: 'ru', messages: ru })
    expect(resolveDesktopStartupLocale('ja-JP', ['zh-CN'])).toEqual({ id: 'ru', messages: ru })
  })

  it('configures Russian-first NSIS installerLanguages, macOS CFBundleLocalizations, and 100% strings.nsh parity', () => {
    expect(STRATA_NSIS_INSTALLER_LANGUAGES).toEqual(['ru_RU', 'en_US', 'zh_CN'])

    const config = createElectronBuilderConfig({
      DSH_DESKTOP_APP_ID: 'com.nikl.strataharness',
      DSH_DESKTOP_TARGET_PLATFORM: 'win32',
      DSH_DESKTOP_TARGET_ARCH: 'x64',
      DSH_DESKTOP_UNSIGNED: '1',
    }, 'win32', 'x64')
    expect(config.nsis.installerLanguages).toEqual(['ru_RU', 'en_US', 'zh_CN'])
    expect(config.mac.extendInfo.CFBundleLocalizations).toEqual(['ru', 'en', 'zh_CN'])

    const stringsPath = resolve(import.meta.dirname, '..', 'installer', 'strings.nsh')
    const stringsSource = readFileSync(stringsPath, 'utf8')
    expect(stringsSource).not.toContain('!ifdef LANG_RUSSIAN')

    const keysByLanguage = new Map<string, string[]>([
      ['ENGLISH', []],
      ['SIMPCHINESE', []],
      ['RUSSIAN', []],
    ])
    for (const line of stringsSource.split(/\r?\n/u)) {
      const match = /^LangString\s+(INSTALLER_\w+)\s+\$\{LANG_(ENGLISH|SIMPCHINESE|RUSSIAN)\}\s+"(.*)"$/u.exec(line)
      if (match === null) continue
      const key = match[1]!
      const lang = match[2]!
      const text = match[3]!
      expect(text.trim().length).toBeGreaterThan(0)
      keysByLanguage.get(lang)!.push(key)
    }

    const englishKeys = [...keysByLanguage.get('ENGLISH')!].sort()
    expect(englishKeys.length).toBeGreaterThan(0)
    expect([...keysByLanguage.get('SIMPCHINESE')!].sort()).toEqual(englishKeys)
    expect([...keysByLanguage.get('RUSSIAN')!].sort()).toEqual(englishKeys)
  })
})
