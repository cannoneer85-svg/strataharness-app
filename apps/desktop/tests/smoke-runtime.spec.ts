/** Behavioral checks for packaged Office skill probe results and smoke runtime helpers. */

import { once } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import {
  assertOfficeSkillsLoadable,
  requestSmokeEndpoint,
  SMOKE_OFFICE_BATCH_HTTP_TIMEOUT_MS,
  SMOKE_OFFICE_CONVERT_HTTP_TIMEOUT_MS,
  SMOKE_OFFICE_OPERATION_TIMEOUT_MS,
  SMOKE_PROFILE_PATCH_YAML,
} from '../scripts/smoke-runtime.ts'

const loadedSkills = [
  { name: 'office', bytes: 772 },
  { name: 'office-docx', bytes: 4543 },
  { name: 'office-pptx', bytes: 5167 },
  { name: 'office-xlsx', bytes: 5611 },
]

describe('assertOfficeSkillsLoadable', () => {
  it('accepts all four Office skills with nonempty bodies and no path', () => {
    expect(() => { assertOfficeSkillsLoadable(loadedSkills) }).not.toThrow()
  })

  it('rejects an unlisted or empty Office skill and reports every result', () => {
    const results = loadedSkills.map(skill => skill.name === 'office-docx' ? { ...skill, bytes: 0 } : skill)
    expect(() => { assertOfficeSkillsLoadable(results) }).toThrow(
      `desktop runtime: packaged Office skills are not loadable: ${JSON.stringify(results)}`,
    )
  })

  it('rejects results missing a bundled Office skill', () => {
    const results = loadedSkills.filter(skill => skill.name !== 'office-xlsx')
    expect(() => { assertOfficeSkillsLoadable(results) }).toThrow(
      `desktop runtime: packaged Office skills are not loadable: ${JSON.stringify(results)}`,
    )
  })

  it('ignores empty results for skills outside the bundled Office set', () => {
    expect(() => { assertOfficeSkillsLoadable([...loadedSkills, { name: 'other', bytes: 0 }]) }).not.toThrow()
  })
})

describe('SMOKE_PROFILE_PATCH_YAML', () => {
  it('configures webserver on ephemeral loopback and office-kit timeoutMs to 300000', () => {
    const entries = load(SMOKE_PROFILE_PATCH_YAML) as Array<{ id?: string; config?: Record<string, unknown> }>
    expect(SMOKE_OFFICE_OPERATION_TIMEOUT_MS).toBe(300_000)
    expect(entries).toEqual([
      { id: 'webserver', config: { host: '127.0.0.1', port: 0 } },
      { id: 'office-kit', config: { timeoutMs: 300_000 } },
    ])
  })

  it('keeps client HTTP timeouts strictly above single and three-step Office operation deadlines', () => {
    expect(SMOKE_OFFICE_CONVERT_HTTP_TIMEOUT_MS).toBe(330_000)
    expect(SMOKE_OFFICE_CONVERT_HTTP_TIMEOUT_MS).toBeGreaterThan(SMOKE_OFFICE_OPERATION_TIMEOUT_MS)
    expect(SMOKE_OFFICE_BATCH_HTTP_TIMEOUT_MS).toBe(930_000)
    expect(SMOKE_OFFICE_BATCH_HTTP_TIMEOUT_MS).toBeGreaterThan(SMOKE_OFFICE_OPERATION_TIMEOUT_MS * 3)
  })
})

describe('requestSmokeEndpoint', () => {
  it('reads status, body bytes, and forwards cookie headers on delayed responses', async () => {
    const server = createServer((req, res) => {
      setTimeout(() => {
        res.statusCode = 200
        res.end(req.headers.cookie ?? '')
      }, 30)
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    try {
      const { port } = server.address() as AddressInfo
      const result = await requestSmokeEndpoint(new URL(`http://127.0.0.1:${port}/probe`), 'session=ok', 5_000)
      expect(result.statusCode).toBe(200)
      expect(result.body.toString('utf8')).toBe('session=ok')
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    }
  })

  it('aborts when response headers exceed timeoutMs', async () => {
    const server = createServer((_req, _res) => {
      // Leave request open past client timeout without flushing headers.
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    try {
      const { port } = server.address() as AddressInfo
      await expect(requestSmokeEndpoint(new URL(`http://127.0.0.1:${port}/hang`), 'session=ok', 40))
        .rejects.toThrow()
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    }
  })
})
