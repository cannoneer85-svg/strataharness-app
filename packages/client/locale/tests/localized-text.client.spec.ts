import { describe, expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '../src/client/index.ts'

function make() {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  return { ctx, locale: new LocaleRuntime(ctx) }
}

describe('package text resolution', () => {
  it('keeps strings verbatim without common lookup or interpolation', () => {
    const { ctx, locale } = make()
    ctx.effect(() => locale.register('common', 'zh', { retry: '重试' }), 'test: common dictionary')
    locale.setLocale('zh')

    expect(locale.resolveText('retry')).toBe('retry')
    expect(locale.resolveText('Hello, {name}')).toBe('Hello, {name}')
    expect(locale.resolveText('')).toBe('')
    expect(locale.resolveText({ en: 'retry' })).toBe('retry')
  })

  it('resolves each field in the current locale without registering map languages', () => {
    const { locale } = make()
    const title = { en: 'Tools', zh: '工具', ja: 'ツール' }
    locale.setLocale('zh')
    const snapshot = locale.getSnapshot()

    expect(locale.resolveText(title)).toBe('工具')
    expect(locale.resolveText({ en: 'English description' })).toBe('English description')
    expect(locale.resolveText({ en: 'Fallback', zh: '' })).toBe('')
    expect(locale.getSnapshot()).toBe(snapshot)
    expect(snapshot.locales.map(item => item.id)).toEqual(['zh', 'en'])

    locale.setLocale('en')
    expect(locale.resolveText(title)).toBe('Tools')
  })

  it('walks registered regional fallbacks using lowercase map keys', () => {
    const { ctx, locale } = make()
    ctx.effect(() => locale.addLanguage({ id: 'fr', label: 'Français', fallback: 'en' }), 'test: French')
    ctx.effect(() => locale.addLanguage({ id: 'fr-CA', label: 'Français (Canada)', fallback: 'fr' }), 'test: Canadian French')
    locale.setLocale('FR-ca')

    expect(locale.resolveText({ en: 'Tools', fr: 'Outils', 'fr-ca': 'Outils Québec' })).toBe('Outils Québec')
    expect(locale.resolveText({ en: 'Tools', fr: 'Outils' })).toBe('Outils')
    expect(locale.resolveText({ en: 'Tools', zh: '工具' })).toBe('Tools')
  })

  it('uses English across an unloaded fallback and follows its replacement', () => {
    const { ctx, locale } = make()
    const removeFrench = locale.addLanguage({ id: 'fr', label: 'Français', fallback: 'en' })
    ctx.effect(() => removeFrench, 'test: French')
    ctx.effect(() => locale.addLanguage({ id: 'fr-CA', label: 'Français (Canada)', fallback: 'fr' }), 'test: Canadian French')
    locale.setLocale('fr-CA')
    const text = { en: 'Tools', fr: 'Outils' }

    expect(locale.resolveText(text)).toBe('Outils')
    removeFrench()
    expect(locale.resolveText(text)).toBe('Tools')
    ctx.effect(() => locale.addLanguage({ id: 'fr', label: 'Français', fallback: 'en' }), 'test: replacement French')
    expect(locale.resolveText(text)).toBe('Outils')
  })

  it('resolves built-in LocalizedText through registered text catalogs while preserving direct text.ru priority and unknown fallbacks', () => {
    const { locale } = make()
    locale.addLanguage({ id: 'ru', label: 'Русский', fallback: 'en' })
    locale.setLocale('ru')

    expect(() => locale.registerTextCatalog('bad locale', { Tools: 'Инструменты' }))
      .toThrow('not a BCP 47-style tag')

    const beforeRevision = locale.getSnapshot().revision
    const disposeBase = locale.registerTextCatalog('ru', {
      Tools: 'Инструменты',
      'Built-in description': 'Описание встроенного плагина',
    })
    expect(locale.getSnapshot().revision).toBe(beforeRevision + 1)

    // Priority 1: explicit text.ru wins over registered catalog (including empty string).
    expect(locale.resolveText({ en: 'Tools', ru: 'Собственные инструменты' })).toBe('Собственные инструменты')
    expect(locale.resolveText({ en: 'Tools', ru: '' })).toBe('')

    // Priority 2: exact match of canonical text.en in registered catalog.
    expect(locale.resolveText({ en: 'Tools', zh: '工具' })).toBe('Инструменты')
    expect(locale.resolveText({ en: 'Built-in description' })).toBe('Описание встроенного плагина')

    // Later catalog overrides earlier catalog until disposed.
    const disposeOverride = locale.registerTextCatalog('RU', { Tools: 'Набор инструментов' })
    expect(locale.resolveText({ en: 'Tools' })).toBe('Набор инструментов')
    disposeOverride()
    disposeOverride()
    expect(locale.resolveText({ en: 'Tools' })).toBe('Инструменты')

    // Priority 3: modified/custom user text or Object.prototype property names fall back to text.en; bare strings stay untouched.
    expect(locale.resolveText({ en: 'Tools (customized by user)' })).toBe('Tools (customized by user)')
    expect(locale.resolveText({ en: 'toString' })).toBe('toString')
    expect(locale.resolveText('Tools')).toBe('Tools')

    // Switching active locale to 'en' returns text.en; disposing catalog restores text.en fallback on 'ru'.
    locale.setLocale('en')
    expect(locale.resolveText({ en: 'Tools' })).toBe('Tools')
    locale.setLocale('ru')
    const revBeforeDispose = locale.getSnapshot().revision
    disposeBase()
    expect(locale.getSnapshot().revision).toBe(revBeforeDispose + 1)
    disposeBase()
    expect(locale.getSnapshot().revision).toBe(revBeforeDispose + 1)
    expect(locale.resolveText({ en: 'Tools' })).toBe('Tools')

    // Inherited prototype properties on a LocalizedText map must not masquerade as own locale translations.
    const inheritedProtoText = Object.assign(
      Object.create({ ru: 'Inherited prototype value' }) as Record<string, string>,
      { en: 'Tools' },
    )
    expect(locale.resolveText(inheritedProtoText)).toBe('Tools')
  })
})
