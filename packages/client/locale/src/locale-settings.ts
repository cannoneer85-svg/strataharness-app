/** Locale preference and deployment defaults shared across Host and browser scopes. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the locale plugin. */
export const LOCALE_SETTINGS_NAMESPACE = 'locale'

/** Field carrying an explicit locale selection; absence delegates to defaultLocale or the browser. */
export const LOCALE_PREFERENCE_FIELD = 'preference'

/** Page-global key carrying Host deployment locale defaults injected by `webserver/index-inject`. */
export const LOCALE_CONFIG_GLOBAL = '__DSH_LOCALE_CONFIG__'

/** Accepted BCP 47-style language ids. */
export const LOCALE_ID_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u

/** Baseline locales required by typed namespace dictionary registration. */
export const LOCALE_IDS = ['zh', 'en'] as const

/** Baseline locale required by typed namespace dictionary registration. */
export type BuiltInLocaleId = typeof LOCALE_IDS[number]

/** Open locale identifier accepted from language-pack plugins. */
export type LocaleId = string

/** Durable locale section shared by the Host schema and the browser scope. */
export interface LocaleSettings {
  /** Explicit locale selection; absence delegates to defaultLocale or the browser. */
  preference?: LocaleId
}

/** Deployment-level locale defaults projected from Host configuration into served pages. */
export interface LocaleDeploymentConfig {
  /** Default locale selected when no explicit user preference is stored. */
  defaultLocale?: LocaleId | undefined
  /** Ordered locale identifiers controlling selector display order. */
  localeOrder?: LocaleId[] | undefined
}

/** Durable locale schema; also the wire envelope the browser scope validates against. */
export const LocaleSettingsFields = {
  [LOCALE_PREFERENCE_FIELD]: z.string().pattern(LOCALE_ID_PATTERN).required(false),
}

/** Schema fields for deployment-level locale defaults. */
export const LocaleDeploymentConfigFields = {
  defaultLocale: (z.string().pattern(LOCALE_ID_PATTERN) as z<LocaleId | undefined>).default(undefined),
  localeOrder: (z.array(z.string().pattern(LOCALE_ID_PATTERN)) as z<LocaleId[] | undefined>).default(undefined),
}

/** Schema for the shared locale preference. */
export const LocaleSettingsSchema = z.object(LocaleSettingsFields)

/** Schema for deployment-level locale defaults read from Host config or page globals. */
export const LocaleDeploymentConfigSchema = z.object(LocaleDeploymentConfigFields)
