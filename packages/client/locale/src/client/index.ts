/**
 * Browser-side locale registry. Bound translation functions retain stable
 * identity for injected consumers. The plugin also registers the Language
 * preference row into the settings General section — the locale feature owns
 * its own settings surface.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { LocalizedText } from '@deepseek-ai/dsh-package-manifest'
import {
  type BoundActions, type LocaleDictOf, type LocaleNamespaceMap, type Translate, type TranslateNS,
} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the ctx.configForms Context merge and the settings slot types.
// Cross-plugin collaboration goes through the service, never a value import
// (client bundle purity gate).
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { parseLocaleBootstrap, type LocaleBootstrap, type LocaleBridge } from './bootstrap.ts'
import { interpolateTemplate } from './interpolate.ts'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import {
  LOCALE_CONFIG_GLOBAL,
  LOCALE_ID_PATTERN,
  LOCALE_IDS,
  LOCALE_PREFERENCE_FIELD,
  LOCALE_SETTINGS_NAMESPACE,
  LocaleDeploymentConfigSchema,
  type BuiltInLocaleId,
  type LocaleDeploymentConfig,
  type LocaleId,
  type LocaleSettings,
} from '../locale-settings.ts'
import { en, ja, es, fr, de, ru, pt, zh, type CommonKey } from '../locales/index.ts'
import {
  en as settingsEn, ja as settingsJa, es as settingsEs, fr as settingsFr,
  de as settingsDe, ru as settingsRu, pt as settingsPt, zh as settingsZh, type SettingsLocaleKey,
} from '../locales/settings.ts'
import type { LanguageRowInjected } from './LanguageRow.tsx'
import { LanguageRow } from './LanguageRow.tsx'
import { createLanguageRowStore } from './settings-store.ts'

export type { LanguageRowComponentProps, LanguageRowInjected } from './LanguageRow.tsx'
export type { LanguageOptionRow, LanguageRowState } from './settings-store.ts'
export type { CommonKey } from '../locales/index.ts'
export type { BuiltInLocaleId, LocaleDeploymentConfig, LocaleId, LocaleSettings } from '../locale-settings.ts'

// The translate currency lives in ui-slots (the render machinery synthesizes
// the seat); re-exported here so dictionary owners import one package.
// TranslateNS<'model'> is the namespace-addressed developer-facing form.
export type { Translate, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Shared cross-feature vocabulary, consulted by the lookup chain after the entry's own namespace misses. */
    common: CommonKey
    /** This feature's own settings-row copy (the Language row). */
    'settings.locale': SettingsLocaleKey
  }
}

/** Locale dictionary: flat key to template string ({name} placeholders and compact ICU plural expressions). */
export type LocaleDict = Record<string, string>

/** Input accepted when a language-pack plugin adds a selectable language. */
export interface LanguageRegistration {
  /** Stable BCP 47-style id stored as the locale preference. */
  id: LocaleId
  /** Display name written in the represented language. */
  label: string
  /** Registered language consulted when this language lacks a dictionary key. */
  fallback: LocaleId
}

/** One normalized selectable locale published in snapshots. */
export interface LocaleDefinition {
  /** Stable id persisted by {@link LocaleRuntime.setLocale}. */
  readonly id: LocaleId
  /** Display name written in the represented language. */
  readonly label: string
  /** Next language in the per-key fallback chain; absent only for English. */
  readonly fallback?: LocaleId
}

/** Immutable locale state published on every change. */
export interface LocaleSnapshot {
  /** Active locale id. */
  active: LocaleId
  /** Selectable locales in display order. */
  locales: readonly LocaleDefinition[]
  /** Monotonic change counter (registry or active changes). */
  revision: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    locale: LocaleRuntime
  }
  interface Events {
    /**
     * The active locale switched. Dictionary registrations do NOT emit this
     * event (listeners may re-register slots in response, and boot registers
     * one namespace per package); continuous render refresh rides the
     * LocaleFace revision instead.
     * @param snapshot - Current immutable locale snapshot.
     * @mode emit
     */
    'locale/change'(snapshot: LocaleSnapshot): void
  }
}

/**
 * English is both the locale the UI opens in when the browser names no registered
 * language (and for non-browser runs), and the dictionary consulted after the
 * active locale misses a key. One constant serves both because the shipped
 * `zh`/`en` dictionaries carry identical key sets, so neither direction can
 * leave a key unresolved; the residual case points at English rather than
 * zh because a browser naming no registered language is the reader least
 * likely to read Chinese.
 */
export const FALLBACK_LOCALE: BuiltInLocaleId = 'en'

/** Shared namespace for shell-level texts. */
export const COMMON_NS = 'common'

/** Namespace owning this feature's settings-row copy. */
export const SETTINGS_NS = 'settings.locale'

/** The baseline locales required by typed dictionary registrations. */
const BUILT_IN_LOCALE_METADATA = {
  zh: { label: '中文', fallback: 'en' },
  en: { label: 'English' },
} as const satisfies Record<BuiltInLocaleId, Omit<LocaleDefinition, 'id'>>
const BUILT_IN_LOCALES: readonly LocaleDefinition[] = Object.freeze(
  LOCALE_IDS.map(id => Object.freeze({ id, ...BUILT_IN_LOCALE_METADATA[id] })),
)

/** Case-insensitive key for BCP 47-style ids. */
function localeKey(value: string): string {
  return value.toLowerCase()
}

/**
 * Match a requested BCP 47 tag against registered locale definitions:
 * exact case-insensitive id first, then exact bare primary subtag, then
 * regional definition sharing the primary subtag.
 */
function matchRegisteredLocale(locales: readonly LocaleDefinition[], tag: string): LocaleId | undefined {
  const requested = localeKey(tag)
  const exact = locales.find(locale => localeKey(locale.id) === requested)
  if (exact !== undefined) return exact.id
  const primary = requested.split('-')[0]
  const bare = locales.find(locale => localeKey(locale.id) === primary)
  if (bare !== undefined) return bare.id
  const regional = locales.find(locale => localeKey(locale.id).split('-')[0] === primary)
  return regional?.id
}

/** Validate and detach a language-pack contribution from its mutable input. */
function normalizeLanguage(input: LanguageRegistration): Readonly<LanguageRegistration> {
  if (!LOCALE_ID_PATTERN.test(input.id)) {
    throw new Error(`locale id "${input.id}" is not a BCP 47-style tag`)
  }
  if (input.label.trim() === '') throw new Error('locale label must not be empty')
  if (!LOCALE_ID_PATTERN.test(input.fallback)) {
    throw new Error(`locale fallback "${input.fallback}" is not a BCP 47-style tag`)
  }
  return Object.freeze({ id: input.id, label: input.label, fallback: input.fallback })
}

/**
 * Point `<html lang>` at the active locale, keeping the served document in
 * sync with locale snapshot changes.
 * @param snapshot - current locale state, including the active definition.
 */
function syncDocumentLanguage(snapshot: LocaleSnapshot): void {
  // Non-browser runs (node boots of the client tree) have no document.
  if (typeof document === 'undefined') return
  const language = snapshot.active === 'zh' ? 'zh-CN' : snapshot.active
  if (document.documentElement.lang !== language) document.documentElement.lang = language
}

interface DictionaryLookupHit {
  readonly locale: LocaleId
  readonly value: string
}

/**
 * Dictionary registry plus locale preference. Lookup walks the active
 * language's declared fallback chain in the entry namespace, then repeats it
 * in the shared common namespace before showing the key itself. Reads go
 * through {@link getLocale}; preferences change only through
 * {@link setLocale}, while language packs extend the catalog through
 * {@link addLanguage}. Continuous sync uses the `locale/change` event or
 * the LocaleFace getSnapshot/subscribe pair installed through
 * `ctx.slots.installLocale`.
 */
export class LocaleRuntime {
  private dicts = new Map<string, Map<string, LocaleDict>>()
  // strata(override): language-pack override layers checked before base dictionaries
  private overrideDicts = new Map<string, Map<string, LocaleDict[]>>()
  private textCatalogs = new Map<string, ReadonlyMap<string, string>[]>()
  private pluralRules = new Map<string, Intl.PluralRules>()
  private bound = new Map<string, Translate>()
  private catalog = new Map<string, LocaleDefinition>()
  private fallbackChains = new Map<string, readonly LocaleId[]>()
  private snapshot: LocaleSnapshot
  private listeners = new Set<() => void>()
  private readonly ctx: ClientContext
  private readonly host: ConfigForm<LocaleSettings> | undefined
  private readonly defaultLocale: LocaleId | undefined
  private readonly localeOrder: readonly LocaleId[] | undefined
  /** Default or browser-derived locale standing wherever no explicit Host selection does. */
  private provisional: LocaleId
  /** Last explicit selection, including one awaiting an external registration. */
  private preference: LocaleId | undefined

  /**
   * @param ctx - owning context (change events are emitted on it; the scope
   * listener is released through ctx.effect on dispose).
   * @param host - durable preference scope owned by the providing plugin;
   * absent compositions (standalone dictionary registries) stay process-local.
   * @param bootstrap - native initialization; absent in ordinary browsers.
   * @param options - optional deployment default locale and selector display order.
   */
  constructor(
    ctx: ClientContext,
    host?: ConfigForm<LocaleSettings>,
    private readonly bootstrap?: LocaleBootstrap,
    options?: LocaleDeploymentConfig,
  ) {
    this.ctx = ctx
    this.host = host
    const configured = options === undefined ? undefined : LocaleDeploymentConfigSchema(options)
    this.defaultLocale = configured?.defaultLocale
    this.localeOrder = configured?.localeOrder
    for (const locale of BUILT_IN_LOCALES) this.catalog.set(localeKey(locale.id), locale)
    const locales = this.localeList()
    this.provisional = resolveInitialLocale(locales, bootstrap?.languages, this.defaultLocale)
    this.preference = bootstrap?.preference ?? undefined
    this.snapshot = Object.freeze({ active: this.resolveActive(locales), locales, revision: 0 })
    if (host !== undefined) {
      ctx.effect(() => host.subscribe(() => { this.adopt(host) }), 'locale: settings scope adoption')
      this.adopt(host)
    }
  }

  /**
   * Read the current immutable locale snapshot.
   * @returns the current snapshot (stable reference until the next change).
   */
  getLocale(): LocaleSnapshot {
    return this.snapshot
  }

  /**
   * Resolve package text through the active language's declared fallback chain.
   * Plain strings stay verbatim; object maps prioritize explicit `text[locale]`
   * entries over registered built-in text catalogs before falling back to `text.en`.
   * @param text - package text whose locale keys are lowercase and include English.
   * @returns the first available translation, including an empty string.
   */
  resolveText(text: LocalizedText): string {
    if (typeof text === 'string') return text
    for (const locale of this.fallbackChain(this.snapshot.active)) {
      const key = localeKey(locale)
      if (key === localeKey(FALLBACK_LOCALE)) break
      const direct = Object.hasOwn(text, key) ? text[key] : undefined
      if (direct !== undefined) return direct
      const catalogValue = this.lookupTextCatalog(key, text.en)
      if (catalogValue !== undefined) return catalogValue
    }
    return text.en
  }

  /**
   * Whether an explicit preference or configured `defaultLocale` names a tag
   * whose language definition has not registered yet.
   * @returns true while the requested locale is unresolved in the current catalog.
   */
  isAwaitingRequestedLocale(): boolean {
    const target = this.preference ?? this.defaultLocale
    return target !== undefined && matchRegisteredLocale(this.snapshot.locales, target) === undefined
  }

  /**
   * Register a localized text catalog keyed by canonical English text (`text.en`)
   * for built-in `LocalizedText` objects that omit a direct key for `locale`.
   * Explicit `text[locale]` entries on a `LocalizedText` object always take precedence.
   * @param locale - BCP 47-style locale identifier this catalog translates into.
   * @param entries - Mapping from exact `text.en` strings to localized strings.
   * @returns Idempotent disposer removing this catalog and bumping the snapshot revision.
   * @throws When `locale` is not a valid BCP 47-style tag.
   */
  registerTextCatalog(locale: LocaleId, entries: Readonly<Record<string, string>>): () => void {
    if (!LOCALE_ID_PATTERN.test(locale)) {
      throw new Error(`locale id "${locale}" is not a BCP 47-style tag`)
    }
    const key = localeKey(locale)
    const table: ReadonlyMap<string, string> = new Map(Object.entries(entries))
    let list = this.textCatalogs.get(key)
    if (list === undefined) {
      list = []
      this.textCatalogs.set(key, list)
    }
    list.push(table)
    this.publish(this.snapshot.active, false)
    return () => {
      const current = this.textCatalogs.get(key)
      if (current === undefined) return
      const index = current.indexOf(table)
      if (index < 0) return
      current.splice(index, 1)
      if (current.length === 0) this.textCatalogs.delete(key)
      this.publish(this.snapshot.active, false)
    }
  }

  /**
   * LocaleFace getSnapshot: the current snapshot (carries `revision`; stable
   * reference between changes, uSES-safe).
   * @returns the current snapshot.
   */
  getSnapshot(): LocaleSnapshot {
    return this.snapshot
  }

  /**
   * LocaleFace subscribe: notified on every snapshot change (locale switch
   * or dictionary registration — registrations bump the revision so already
   * rendered outlets pick up late-arriving dictionaries and locale definitions).
   * @param fn - change callback.
   * @returns unsubscribe.
   */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  /**
   * Switch the active locale — the only user preference write entry.
   *
   * The durable write happens even when the id already matches the active
   * locale, because the active value may be a provisional browser-derived or
   * fallback resolution that nothing has stored yet. Picking the language
   * already on screen is still an explicit choice, and it must survive a
   * different browser sharing the same DSH home. Only the render notification
   * is conditional: republishing an unchanged locale would churn every
   * subscriber for nothing.
   * @param id - a registered locale id; unknown ids throw.
   */
  setLocale(id: string): void {
    const match = this.catalog.get(localeKey(id))
    if (match === undefined) throw new Error(`locale "${id}" is not registered`)
    this.preference = match.id
    if (this.snapshot.active !== match.id) this.publish(match.id, true)
    void this.host?.set(LOCALE_PREFERENCE_FIELD, match.id)
  }

  /**
   * Add one selectable language to the shared catalog. Its fallback must
   * already be registered, and following fallback definitions must terminate
   * at English. Dictionaries may register before or after this definition.
   * Registration rechecks an unresolved Host preference and the browser's
   * ordered language list. The caller owns the returned disposer; removing an
   * active language falls back without clearing the stored id.
   * @param input - stable id, self-described label, and fallback language id.
   * @param options - optional duplicate-id handling (`'ignore'` preserves the existing entry with a no-op disposer).
   * @returns idempotent disposer removing this exact definition.
   * @throws when fields are malformed, the id is occupied under default options, or the fallback
   * target is unknown or creates a cycle.
   */
  addLanguage(input: LanguageRegistration, options?: { readonly ifExists?: 'throw' | 'ignore' }): () => void {
    const candidate = normalizeLanguage(input)
    const key = localeKey(candidate.id)
    if (this.catalog.has(key)) {
      if (options?.ifExists === 'ignore') return () => {}
      throw new Error(`locale "${candidate.id}" is already registered`)
    }
    const fallback = this.catalog.get(localeKey(candidate.fallback))
    if (fallback === undefined) {
      throw new Error(`locale fallback "${candidate.fallback}" is not registered`)
    }
    const language = Object.freeze({ ...candidate, fallback: fallback.id })
    this.catalog.set(key, language)
    try {
      this.assertFallbackChain(language.id)
    } catch (error) {
      this.catalog.delete(key)
      throw error
    }
    this.publishCatalog()
    return () => {
      if (this.catalog.get(key) !== language) return
      this.catalog.delete(key)
      this.publishCatalog()
    }
  }

  /**
   * Adopt the scope's accepted durable selection without writing it back; an
   * absent selection returns to the provisional locale.
   * @param host - the constructor-narrowed scope driving this adoption.
   */
  private adopt(host: ConfigForm<LocaleSettings>): void {
    const section = host.getSnapshot().value
    if (section === undefined) return
    this.preference = section.preference
    const target = this.resolveActive(this.snapshot.locales)
    if (this.snapshot.active === target) return
    this.publish(target, true)
  }

  /** Recompute provisional fallback and publish the current catalog. */
  private publishCatalog(): void {
    this.fallbackChains.clear()
    const locales = this.localeList()
    this.provisional = resolveInitialLocale(locales, this.bootstrap?.languages, this.defaultLocale)
    const active = this.resolveActive(locales)
    this.publish(active, active !== this.snapshot.active, locales)
  }

  /** Resolve an explicit preference (including regional subtags) while a matching definition is available. */
  private resolveActive(locales: readonly LocaleDefinition[]): LocaleId {
    if (this.preference === undefined) return this.provisional
    return matchRegisteredLocale(locales, this.preference) ?? this.provisional
  }

  /** Snapshot the catalog ordered by configured `localeOrder`, then registration order. */
  private localeList(): readonly LocaleDefinition[] {
    if (this.localeOrder === undefined || this.localeOrder.length === 0) {
      return Object.freeze([...this.catalog.values()])
    }
    const ordered: LocaleDefinition[] = []
    const seen = new Set<string>()
    for (const id of this.localeOrder) {
      const key = localeKey(id)
      if (seen.has(key)) continue
      const definition = this.catalog.get(key)
      if (definition !== undefined) {
        seen.add(key)
        ordered.push(definition)
      }
    }
    for (const [key, definition] of this.catalog) {
      if (!seen.has(key)) ordered.push(definition)
    }
    return Object.freeze(ordered)
  }

  private lookupTextCatalog(key: string, sourceEn: string): string | undefined {
    const list = this.textCatalogs.get(key)
    if (list === undefined) return undefined
    let hit: string | undefined
    for (const catalog of list) {
      const value = catalog.get(sourceEn)
      if (value !== undefined) hit = value
    }
    return hit
  }

  private pluralRulesFor(locale: LocaleId): Intl.PluralRules {
    const key = localeKey(locale)
    let rules = this.pluralRules.get(key)
    if (rules === undefined) {
      try {
        rules = new Intl.PluralRules(locale)
      } catch (_rangeError) {
        // Synthetic BCP 47-style tags accepted by LOCALE_ID_PATTERN (e.g. "ru-x")
        // can fail Intl canonicalization; fall back to English plural categories.
        rules = new Intl.PluralRules(FALLBACK_LOCALE)
      }
      this.pluralRules.set(key, rules)
    }
    return rules
  }

  /** Fail a new definition whose complete fallback path does not reach English. */
  private assertFallbackChain(start: LocaleId): void {
    const seen = new Set<string>()
    let current = this.catalog.get(localeKey(start))
    while (current !== undefined) {
      const key = localeKey(current.id)
      if (seen.has(key)) throw new Error(`locale fallback cycle includes "${current.id}"`)
      seen.add(key)
      if (key === localeKey(FALLBACK_LOCALE)) return
      /* v8 ignore next -- English is the only built-in terminal and every
       * language accepted by addLanguage has a required fallback. */
      if (current.fallback === undefined) {
        throw new Error(`locale "${current.id}" fallback chain does not reach "${FALLBACK_LOCALE}"`)
      }
      const next = this.catalog.get(localeKey(current.fallback))
      if (next === undefined) {
        throw new Error(`locale fallback "${current.fallback}" is not registered`)
      }
      current = next
    }
  }

  /** Resolve a lookup chain, falling directly to English across an unload gap. */
  private fallbackChain(start: LocaleId): readonly LocaleId[] {
    const startKey = localeKey(start)
    const cached = this.fallbackChains.get(startKey)
    if (cached !== undefined) return cached
    const chain: LocaleId[] = []
    const seen = new Set<string>()
    let current = this.catalog.get(startKey)
    while (current !== undefined && !seen.has(localeKey(current.id))) {
      const key = localeKey(current.id)
      seen.add(key)
      chain.push(current.id)
      current = current.fallback === undefined
        ? undefined
        : this.catalog.get(localeKey(current.fallback))
    }
    if (!seen.has(localeKey(FALLBACK_LOCALE))) chain.push(FALLBACK_LOCALE)
    const resolved = Object.freeze(chain)
    this.fallbackChains.set(startKey, resolved)
    return resolved
  }

  /**
   * Register a declared namespace's dictionaries, all locales in one call —
   * the typed form: each dictionary is checked against the namespace's
   * {@link LocaleNamespaceMap} key union (a missing or extra key is a
   * compile error), and both baseline locales are required (bilingual balance
   * enforced at registration). Duplicate (ns, locale) throws (single occupant; a
   * namespace's texts have one owner). Registration bumps the revision so
   * mounted outlets pick up late-arriving dictionaries.
   * @param ns - a namespace merged into LocaleNamespaceMap.
   * @param dicts - complete baseline dictionaries and optional dictionaries for additional locale ids.
   * @returns disposer removing every locale registered by this call (idempotent).
   */
  register<N extends Extract<keyof LocaleNamespaceMap, string>>(
    ns: N,
    dicts: Record<BuiltInLocaleId, LocaleDictOf<N>> & Record<LocaleId, LocaleDictOf<N>>,
  ): () => void
  /**
   * Single-locale untyped form for language-pack contributions and namespaces
   * outside the merge table.
   * @param ns - namespace.
   * @param locale - locale tag.
   * @param dict - dictionary.
   * @param options - optional override flag allowing curated language packs to layer on top of shipped dictionaries.
   * @returns disposer (idempotent).
   * @throws when locale is not a BCP 47-style tag.
   */
  register(ns: string, locale: string, dict: LocaleDict, options?: { readonly override?: boolean }): () => void
  register(
    ns: string,
    localeOrDicts: string | Record<string, LocaleDict>,
    dict?: LocaleDict,
    options?: { readonly override?: boolean },
  ): () => void {
    const pairs: [string, LocaleDict][] = typeof localeOrDicts === 'string'
      // Overload guarantees dict on the single-locale arm.
      ? [[localeOrDicts, dict as LocaleDict]]
      : Object.entries(localeOrDicts)
    for (const [locale] of pairs) {
      if (!LOCALE_ID_PATTERN.test(locale)) {
        throw new Error(`locale id "${locale}" is not a BCP 47-style tag`)
      }
    }
    if (typeof localeOrDicts === 'string' && options?.override) {
      const targetKey = localeKey(localeOrDicts)
      const entries = dict as LocaleDict
      let overrides = this.overrideDicts.get(ns)
      if (!overrides) {
        overrides = new Map()
        this.overrideDicts.set(ns, overrides)
      }
      let stack = overrides.get(targetKey)
      if (!stack) {
        stack = []
        overrides.set(targetKey, stack)
      }
      stack.push(entries)
      this.publish(this.snapshot.active, false)
      return () => {
        const owner = this.overrideDicts.get(ns)?.get(targetKey)
        if (!owner) return
        const idx = owner.indexOf(entries)
        if (idx < 0) return
        owner.splice(idx, 1)
        if (owner.length === 0) this.overrideDicts.get(ns)?.delete(targetKey)
        this.publish(this.snapshot.active, false)
      }
    }
    let locales = this.dicts.get(ns)
    if (!locales) {
      locales = new Map()
      this.dicts.set(ns, locales)
    }
    for (const [locale] of pairs) {
      if (locales.has(localeKey(locale))) {
        throw new Error(`locale namespace "${ns}" already has locale "${locale}"`)
      }
    }
    for (const [locale, entries] of pairs) locales.set(localeKey(locale), entries)
    this.publish(this.snapshot.active, false)
    return () => {
      const owner = this.dicts.get(ns)
      /* v8 ignore next -- defensive: a namespace's locales map is created on
       * first register and never removed, so the disposer always finds it. */
      if (!owner) return
      let removed = false
      for (const [locale, entries] of pairs) {
        const key = localeKey(locale)
        if (owner.get(key) === entries) {
          owner.delete(key)
          removed = true
        }
      }
      if (removed) this.publish(this.snapshot.active, false)
    }
  }

  /**
   * Bind a declared namespace to a translate function typed to its
   * dictionary key union (plus the shared common vocabulary) — the same key
   * domain the framework-injected `t` seat carries. The returned reference
   * is stable per namespace (repeat binds return the same function), so it
   * can ride inject surfaces without breaking memoization.
   * @param ns - a namespace merged into LocaleNamespaceMap.
   * @returns the typed translate function (reads the active locale at call time).
   */
  bind<N extends Extract<keyof LocaleNamespaceMap, string>>(ns: N): TranslateNS<N>
  /**
   * Untyped form for namespaces outside the merge table (dynamic
   * composition, tests).
   * @param ns - namespace.
   * @returns the translate function.
   */
  bind(ns: string): Translate
  bind(ns: string): Translate {
    let t = this.bound.get(ns)
    if (!t) {
      t = (key, params) => this.translate(ns, key, params)
      this.bound.set(ns, t)
      return t
    }
    return t
  }

  private translate(ns: string, key: string, params?: Record<string, unknown>): string {
    const chain = this.fallbackChain(this.snapshot.active)
    const hit = this.lookup(ns, key, chain)
      ?? (ns !== COMMON_NS ? this.lookup(COMMON_NS, key, chain) : undefined)
    const template = hit?.value ?? key
    if (!params || !template.includes('{')) return template
    const templateLocale = hit?.locale ?? this.snapshot.active
    return interpolateTemplate(template, params, value => this.pluralRulesFor(templateLocale).select(value))
  }

  private lookup(ns: string, key: string, chain: readonly LocaleId[]): DictionaryLookupHit | undefined {
    const overrides = this.overrideDicts.get(ns)
    const locales = this.dicts.get(ns)
    for (const locale of chain) {
      const normalized = localeKey(locale)
      const layer = overrides?.get(normalized)
      if (layer !== undefined) {
        for (let i = layer.length - 1; i >= 0; i -= 1) {
          const overrideDict = layer[i]
          const value = overrideDict !== undefined && Object.hasOwn(overrideDict, key) ? overrideDict[key] : undefined
          if (value !== undefined) return { locale, value }
        }
      }
      const dict = locales?.get(normalized)
      const value = dict !== undefined && Object.hasOwn(dict, key) ? dict[key] : undefined
      if (value !== undefined) return { locale, value }
    }
    return undefined
  }

  /**
   * Advance the snapshot revision and notify LocaleFace subscribers (render
   * refresh). Only an active-locale switch additionally emits
   * `locale/change` — dictionary registrations stay off the event so
   * registration-heavy boot cannot storm event listeners (which may
   * re-register slots in response).
   */
  private publish(
    active: LocaleId,
    localeChanged: boolean,
    locales: readonly LocaleDefinition[] = this.snapshot.locales,
  ): void {
    this.snapshot = Object.freeze({
      active,
      locales,
      revision: this.snapshot.revision + 1,
    })
    if (localeChanged) this.ctx.emit('locale/change', this.snapshot)
    for (const fn of [...this.listeners]) {
      try {
        fn()
      } catch (error) {
        // One throwing subscriber must not strand the rest on a stale
        // revision (outlets would keep the previous language).
        console.error('locale subscriber crashed:', error)
      }
    }
  }
}

/**
 * Configured deployment `defaultLocale` wins over browser detection and degrades
 * to {@link FALLBACK_LOCALE} when unregistered; otherwise browser languages win
 * over {@link FALLBACK_LOCALE}.
 */
function resolveInitialLocale(
  locales: readonly LocaleDefinition[],
  languages?: readonly string[],
  defaultLocale?: LocaleId,
): LocaleId {
  if (defaultLocale !== undefined) {
    return matchRegisteredLocale(locales, defaultLocale) ?? FALLBACK_LOCALE
  }
  return detectBrowserLocale(locales, languages) ?? FALLBACK_LOCALE
}

/**
 * The first registered locale the browser asks for. Each browser tag first
 * matches a locale id exactly, then its primary subtag, so an exact regional
 * registration wins before a language-wide fallback.
 * `window` is the browser test, not `navigator`: Node exposes a global
 * `navigator` reporting the machine's own language, which must not decide the
 * locale for non-browser runs. `navigator.language` trails the ordered
 * `languages` list and covers hosts exposing only the single tag.
 * @param locales - definitions currently available to the browser.
 * @param languages - native system language order, when supplied by a shell.
 * @returns the first matching locale id, or undefined.
 */
function detectBrowserLocale(locales: readonly LocaleDefinition[], languages?: readonly string[]): LocaleId | undefined {
  if (languages === undefined) {
    if (typeof window === 'undefined') return undefined
    // Embedders and older WebViews may omit the DOM-typed `languages` property.
    const browserLanguages = (navigator as { readonly languages?: readonly string[] }).languages
    languages = [...(browserLanguages ?? []), navigator.language]
  }
  for (const tag of languages) {
    const match = matchRegisteredLocale(locales, tag)
    if (match !== undefined) return match
  }
  return undefined
}

/** Required services: slot registration plus the settings transport. */
export const inject = ['slots', 'remote', 'configForms']

/**
 * Client plugin body: provide the locale service with base dictionaries and
 * register the feature-owned Language preference row into the General
 * section's item slot (a feature owns its settings surface).
 * @param ctx - client cordis context.
 * @param options - optional deployment locale configuration overriding page globals.
 * @returns resolves after native language initialization and plugin registration.
 */
export async function apply(ctx: ClientContext, options?: LocaleDeploymentConfig): Promise<void> {
  const page = globalThis as Partial<Record<typeof LOCALE_CONFIG_GLOBAL, unknown>>
  const payload = page[LOCALE_CONFIG_GLOBAL]
  const injected: LocaleDeploymentConfig = payload === undefined ? {} : LocaleDeploymentConfigSchema(payload)
  const parsedOptions: LocaleDeploymentConfig | undefined = options === undefined
    ? undefined
    : LocaleDeploymentConfigSchema(options)
  const deployment: LocaleDeploymentConfig = {
    defaultLocale: parsedOptions?.defaultLocale ?? injected.defaultLocale,
    localeOrder: parsedOptions?.localeOrder ?? injected.localeOrder,
  }
  const bridge = (globalThis as { __DSH_LOCALE__?: LocaleBridge }).__DSH_LOCALE__
  let bootstrap: LocaleBootstrap | undefined
  if (bridge !== undefined) {
    let value: unknown
    try {
      value = await bridge.read()
    } catch (error) {
      if (ctx.fiber.uid === null) return
      throw error
    }
    if (ctx.fiber.uid === null) return
    bootstrap = parseLocaleBootstrap(value)
  }
  const host = ctx.configForms.get<LocaleSettings>(LOCALE_SETTINGS_NAMESPACE)
  // strata(override): pass resolved deployment locale defaults and order into LocaleRuntime
  const locale = new LocaleRuntime(ctx, host, bootstrap, deployment)
  for (const [id, label] of [['ja', '日本語'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['ru', 'Русский'], ['pt', 'Português']] as const) {
    ctx.effect(() => locale.addLanguage({ id, label, fallback: 'en' }), `locale: ${id} language`)
  }
  ctx.effect(() => locale.register(COMMON_NS, { zh, en, ja, es, fr, de, ru, pt }), 'locale: common dictionaries')
  ctx.effect(() => locale.register(SETTINGS_NS, { zh: settingsZh, en: settingsEn, ja: settingsJa, es: settingsEs, fr: settingsFr, de: settingsDe, ru: settingsRu, pt: settingsPt }), 'locale: settings dictionaries')
  ctx.provide('locale', locale)
  let awaitingInitialLocale = locale.isAwaitingRequestedLocale()
  let initialLocaleTimer: ReturnType<typeof setTimeout> | undefined
  if (awaitingInitialLocale) {
    initialLocaleTimer = setTimeout(() => {
      awaitingInitialLocale = false
      initialLocaleTimer = undefined
      const snapshot = locale.getSnapshot()
      syncDocumentLanguage(snapshot)
      if (bridge !== undefined) bridge.onChange(snapshot.active)
    }, 0)
    ctx.effect(() => () => {
      clearTimeout(initialLocaleTimer)
      initialLocaleTimer = undefined
    }, 'locale: deferred initial locale sync')
  }
  if (bridge !== undefined) {
    ctx.on('locale/change', (snapshot) => { bridge.onChange(snapshot.active) })
    if (!awaitingInitialLocale) bridge.onChange(locale.getSnapshot().active)
  }
  // The service IS the LocaleFace (bind + getSnapshot/subscribe): install it
  // so the render machinery can synthesize the `t` standard seat.
  ctx.slots.installLocale(locale)

  const store = createLanguageRowStore()
  let bound: BoundActions<typeof store> | undefined
  const sync = (): void => {
    const snapshot = locale.getSnapshot()
    if (awaitingInitialLocale && !locale.isAwaitingRequestedLocale()) {
      awaitingInitialLocale = false
      clearTimeout(initialLocaleTimer)
      initialLocaleTimer = undefined
    }
    if (!awaitingInitialLocale) syncDocumentLanguage(snapshot)
    bound?.sync(
      snapshot.active,
      snapshot.locales.map(l => ({ id: l.id, label: l.label })),
      snapshot.revision,
    )
  }
  ctx.effect(() => locale.subscribe(sync), 'locale: language row and document synchronization')
  // The served markup declares one language; the resolved locale may differ
  // (browser detection, or a stored preference adopted after activation), so
  // state it once at activation rather than waiting for the first change.
  sync()
  const injectedFace = (actions: BoundActions<typeof store>): LanguageRowInjected => {
    bound = actions
    // Re-sync from the getter so no event is lost between registration and
    // first render (the store's revision guard drops stale duplicates).
    sync()
    return {
      setLocale: (id) => { locale.setLocale(id) },
    }
  }
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'language',
    order: 0,
    store,
    locale: SETTINGS_NS,
    inject: injectedFace,
  }, LanguageRow))
}
