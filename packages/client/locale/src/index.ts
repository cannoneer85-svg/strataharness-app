/** Host registration and page bootstrap for browser locale preferences and deployment defaults. */
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'

import type { Context, Volatile } from '@deepseek-ai/cordis'

import z from '@deepseek-ai/schemastery'
import {
  LOCALE_CONFIG_GLOBAL,
  LOCALE_PREFERENCE_FIELD,
  LocaleDeploymentConfigFields,
  LocaleSettingsFields,
  type LocaleDeploymentConfig,
  type LocaleId,
} from './locale-settings.ts'

export {
  LOCALE_IDS,
  LOCALE_PREFERENCE_FIELD,
  LOCALE_SETTINGS_NAMESPACE,
  type BuiltInLocaleId,
  type LocaleId,
  type LocaleSettings,
} from './locale-settings.ts'

/** Runtime preferences and deployment locale defaults projected to the browser. */
export interface Config {
  /** Explicit locale; omission follows defaultLocale or the browser. */
  preference: Volatile<string | undefined>
  /** Default locale selected when no explicit user preference is stored. */
  defaultLocale?: LocaleId | undefined
  /** Ordered locale identifiers controlling selector display order. */
  localeOrder?: LocaleId[] | undefined
}

/** Live preference and deployment locale configuration projected to the browser. */
export const Config = z.object({
  preference: LocaleSettingsFields[LOCALE_PREFERENCE_FIELD].volatile(),
  defaultLocale: LocaleDeploymentConfigFields.defaultLocale,
  localeOrder: LocaleDeploymentConfigFields.localeOrder,
})

/**
 * Configure settings presentation policy and project deployment locale defaults into served HTML pages.
 * @param ctx - Plugin context used for optional settings presentation and index injection.
 * @param config - Validated host preference and deployment locale configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  if (config.defaultLocale !== undefined || config.localeOrder !== undefined) {
    const value: LocaleDeploymentConfig = {
      ...(config.defaultLocale === undefined ? {} : { defaultLocale: config.defaultLocale }),
      ...(config.localeOrder === undefined ? {} : { localeOrder: [...config.localeOrder] }),
    }
    ctx.on('webserver/index-inject', (table) => {
      table.push({ kind: 'global', name: LOCALE_CONFIG_GLOBAL, value })
    })
  }
}
