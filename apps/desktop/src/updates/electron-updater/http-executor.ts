/** Electron-native inactivity deadlines for updater checks, full downloads, and blockmap requests. */
import type { RequestOptions } from 'node:http'
import { ElectronHttpExecutor } from 'electron-updater/out/electronHttpExecutor.js'
import type { ClientRequest, IncomingMessage } from 'electron'

function extractHostWithoutPort(authority: string): string {
  const trimmed = authority.trim()
  if (trimmed === '' || trimmed.startsWith('[')) return trimmed
  const colonIndex = trimmed.indexOf(':')
  return colonIndex === -1 ? trimmed : trimmed.slice(0, colonIndex)
}

function isBlockedDeepSeekHost(hostname: string): boolean {
  const normalized = extractHostWithoutPort(hostname).toLowerCase().replace(/\.$/u, '')
  return normalized === 'deepseek.com' || normalized.endsWith('.deepseek.com')
}

/**
 * Reject updater HTTP requests targeting `deepseek.com` or `*.deepseek.com` before opening a socket.
 * @param options - Request options prepared by `electron-updater` (direct or redirected).
 */
export function assertIsolatedUpdaterRequestTarget(options: RequestOptions & { readonly url?: string }): void {
  const candidates: string[] = []
  if (typeof options.url === 'string' && options.url.trim() !== '') {
    try {
      candidates.push(new URL(options.url).hostname)
    } catch (_invalidUrl) {
      candidates.push(options.url)
    }
  }
  if (typeof options.hostname === 'string') candidates.push(options.hostname)
  if (typeof options.host === 'string') candidates.push(options.host)
  const headers = options.headers
  if (headers !== undefined) {
    for (const [key, headerValue] of Object.entries(headers)) {
      if (key.toLowerCase() !== 'host' || headerValue === undefined) continue
      if (Array.isArray(headerValue)) candidates.push(...headerValue)
      else candidates.push(String(headerValue))
    }
  }
  for (const candidate of candidates) {
    if (isBlockedDeepSeekHost(candidate)) {
      throw new Error('desktop auto-update: DeepSeek update domains are blocked in StrataHarness')
    }
  }
}

/** Retains electron-updater transport and proxy handling while bounding silent connections. */
export class DesktopUpdateHttpExecutor extends ElectronHttpExecutor {
  /**
   * @param idleTimeoutMs - Maximum silence before headers or between response chunks, not a total download deadline.
   * @param proxyLogin - Existing updater login event forwarding.
   */
  constructor(private readonly idleTimeoutMs: number, proxyLogin?: ConstructorParameters<typeof ElectronHttpExecutor>[0]) {
    super(proxyLogin)
    if (!Number.isSafeInteger(idleTimeoutMs) || idleTimeoutMs < 1000 || idleTimeoutMs > 2_147_483_647) {
      throw new Error('desktop update: HTTP idle timeout must be an integer from 1000 through 2147483647')
    }
  }

  override createRequest(
    options: RequestOptions & { readonly url?: string },
    callback: (response: IncomingMessage) => void,
  ): ClientRequest {
    assertIsolatedUpdaterRequestTarget(options)
    return super.createRequest(options, callback)
  }

  override addErrorAndTimeoutHandlers(request: ClientRequest, reject: (error: Error) => void): void {
    // The upstream socket timer is for Node HTTP; Electron ClientRequest has response/close events instead.
    super.addErrorAndTimeoutHandlers(request, reject, this.idleTimeoutMs)
    let response: IncomingMessage | undefined
    let timer: ReturnType<typeof setTimeout>
    const stop = (): void => {
      clearTimeout(timer)
      request.off('response', onResponse)
      request.off('abort', stop)
      request.off('error', stop)
      response?.off('data', refresh)
      response?.off('end', stop)
      response?.off('error', stop)
    }
    const refresh = (): void => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        stop()
        reject(Object.assign(new Error('Desktop update connection timed out'), { code: 'ETIMEDOUT' }))
        request.abort()
      }, this.idleTimeoutMs)
    }
    const onResponse = (incoming: IncomingMessage): void => {
      response = incoming
      response.on('data', refresh)
      response.once('end', stop)
      response.once('error', stop)
      refresh()
    }
    request.once('response', onResponse)
    // Electron 44 can emit writable close after finish, before response headers arrive.
    request.once('abort', stop)
    request.once('error', stop)
    refresh()
  }
}
