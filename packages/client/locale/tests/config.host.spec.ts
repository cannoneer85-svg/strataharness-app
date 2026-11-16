import { Context } from '@deepseek-ai/cordis'
import type { IndexInjection, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { describe, expect, it } from 'vitest'
import * as HostPlugin from '../src/index.ts'
import { LOCALE_CONFIG_GLOBAL } from '../src/locale-settings.ts'
import { liveConfig, omitsGeneratedPage } from '../../../settings/settings/tests/live-config.ts'
import { plainConfig } from '../../../settings/settings/src/schema.ts'
import {
  Config, apply,
} from '@deepseek-ai/dsh-client-locale'

const PAGE_PEER = { principal: { kind: 'owner' } } as Parameters<WebServer['renderIndex']>[1]


describe('locale host', () => {
  it('registers an open locale preference with the Host settings lifecycle', async () => {
    const ctx = new Context()
    const configuration = await liveConfig(ctx, { Config, apply })
    const { fiber } = configuration
    expect(plainConfig(configuration.fiber.effectiveConfig)).toEqual({})
    await configuration.update({ preference: 'en' })
    expect(plainConfig(configuration.fiber.effectiveConfig)).toEqual({ preference: 'en' })
    await configuration.update({ preference: 'pt-BR' })
    expect(plainConfig(configuration.fiber.effectiveConfig)).toEqual({ preference: 'pt-BR' })
    await expect(configuration.update({ preference: 'bad locale' })).rejects.toThrow()
    await expect(configuration.update({ preference: '123' })).rejects.toThrow()
    await fiber.dispose()
  })

  it('validates deployment defaultLocale and localeOrder and injects __DSH_LOCALE_CONFIG__ only when configured', async () => {
    expect(Config({ defaultLocale: 'ru', localeOrder: ['ru', 'en', 'zh'] })).toMatchObject({
      defaultLocale: 'ru',
      localeOrder: ['ru', 'en', 'zh'],
    })
    for (const bad of ['', '   ', 'bad locale', '123', ' ru ']) {
      expect(() => Config({ defaultLocale: bad })).toThrow()
      expect(() => Config({ localeOrder: [bad] })).toThrow()
    }

    const unconfigured = new Context()
    try {
      apply(unconfigured, Config({}))
      const table: IndexInjection[] = []
      await unconfigured.parallel('webserver/index-inject', table, PAGE_PEER)
      expect(table).toEqual([])
    } finally {
      await unconfigured.fiber.dispose()
    }

    const defaultOnly = new Context()
    try {
      apply(defaultOnly, Config({ defaultLocale: 'ru' }))
      const table: IndexInjection[] = []
      await defaultOnly.parallel('webserver/index-inject', table, PAGE_PEER)
      expect(table).toEqual([{ kind: 'global', name: LOCALE_CONFIG_GLOBAL, value: { defaultLocale: 'ru' } }])
    } finally {
      await defaultOnly.fiber.dispose()
    }

    const orderOnly = new Context()
    try {
      apply(orderOnly, Config({ localeOrder: ['ru', 'en', 'zh'] }))
      const table: IndexInjection[] = []
      await orderOnly.parallel('webserver/index-inject', table, PAGE_PEER)
      expect(table).toEqual([{ kind: 'global', name: LOCALE_CONFIG_GLOBAL, value: { localeOrder: ['ru', 'en', 'zh'] } }])
    } finally {
      await orderOnly.fiber.dispose()
    }

    const both = new Context()
    try {
      apply(both, Config({ defaultLocale: 'ru', localeOrder: ['ru', 'en', 'zh'] }))
      const table: IndexInjection[] = []
      await both.parallel('webserver/index-inject', table, PAGE_PEER)
      expect(table).toEqual([{
        kind: 'global',
        name: LOCALE_CONFIG_GLOBAL,
        value: { defaultLocale: 'ru', localeOrder: ['ru', 'en', 'zh'] },
      }])
    } finally {
      await both.fiber.dispose()
    }
  })
})

it('keeps its own instance off the generated Settings pages', () => omitsGeneratedPage(ctx => ctx.plugin(HostPlugin)))
