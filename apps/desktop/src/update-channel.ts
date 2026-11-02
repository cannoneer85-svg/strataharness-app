/** Resolve the update channel and GitHub release repository sealed into the installed application manifest. */

import { assertIsolatedUpdaterRequestTarget } from './update-http-executor.ts'

/** Installer-owned channel, independent of release version and upload environment. */
export type DesktopUpdateChannel = 'nightly' | 'latest'

/** Validated GitHub release repository coordinates. */
export interface GitHubReleaseRepositoryTarget {
  /** Repository owner login or organization name. */
  readonly owner: string
  /** Repository name without a `.git` suffix. */
  readonly repo: string
  /** Canonical HTTPS repository URL (`https://github.com/<owner>/<repo>`). */
  readonly repositoryUrl: string
}

/**
 * Parse and validate an isolated HTTPS GitHub release repository URL (`https://github.com/<owner>/<repo>[.git]`).
 * Rejects non-HTTPS URLs, non-GitHub hosts, DeepSeek domains, and the upstream `deepseek-ai/deepseek-harness` repository.
 * @param url - Candidate GitHub repository URL.
 * @returns Parsed repository owner, name, and canonical HTTPS URL, or `undefined` when invalid.
 */
export function parseGitHubReleaseRepository(url: string): GitHubReleaseRepositoryTarget | undefined {
  if (typeof url !== 'string') return undefined
  const trimmed = url.trim()
  if (trimmed === '') return undefined
  let parsedUrl: URL
  try {
    parsedUrl = new URL(trimmed)
    assertIsolatedUpdaterRequestTarget({
      url: parsedUrl.href,
      hostname: parsedUrl.hostname,
      host: parsedUrl.host,
    })
  } catch (_invalidTarget) {
    return undefined
  }
  const host = parsedUrl.hostname.toLowerCase()
  if (
    parsedUrl.protocol !== 'https:'
    || host !== 'github.com'
    || parsedUrl.port !== ''
    || parsedUrl.username !== ''
    || parsedUrl.password !== ''
    || parsedUrl.search !== ''
    || parsedUrl.hash !== ''
  ) {
    return undefined
  }
  const pathMatch = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/u.exec(parsedUrl.pathname)
  if (
    pathMatch === null
    || pathMatch[1] === undefined
    || pathMatch[2] === undefined
    || pathMatch[1] === '.'
    || pathMatch[1] === '..'
    || pathMatch[2] === '.'
    || pathMatch[2] === '..'
  ) {
    return undefined
  }
  const owner = pathMatch[1]
  const repo = pathMatch[2]
  const normalizedOwner = owner.toLowerCase()
  const normalizedRepo = repo.toLowerCase()
  if (
    `${normalizedOwner}/${normalizedRepo}` === 'deepseek-ai/deepseek-harness'
    || normalizedOwner === 'deepseek-ai'
    || normalizedOwner === 'deepseek-harness'
  ) {
    return undefined
  }
  return {
    owner,
    repo,
    repositoryUrl: `https://github.com/${owner}/${repo}`,
  }
}

/**
 * Read the packaged channel; older manifests retain their existing nightly behavior.
 * @param manifest Parsed application manifest.
 * @returns Validated channel. Invalid explicit values reject instead of changing feeds.
 */
export function desktopUpdateChannel(manifest: unknown): DesktopUpdateChannel {
  if (typeof manifest !== 'object' || manifest === null) throw new Error('desktop update: invalid application manifest')
  if (!('dshDesktopUpdateChannel' in manifest)) return 'nightly'
  const channel = manifest.dshDesktopUpdateChannel
  if (channel !== 'nightly' && channel !== 'latest') throw new Error('desktop update: invalid packaged channel')
  return channel
}

/**
 * Read the bundled DSH engine version sealed into the installed application manifest.
 * Unpackaged development checkouts without `dshEngineVersion` fall back to `manifest.version`.
 * @param manifest - Parsed application manifest.
 * @returns Validated DSH engine version, or `undefined` when neither field is present.
 */
export function desktopEngineVersion(manifest: unknown): string | undefined {
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw new Error('desktop update: invalid application manifest')
  }
  if ('dshEngineVersion' in manifest && manifest.dshEngineVersion !== undefined) {
    if (typeof manifest.dshEngineVersion !== 'string' || manifest.dshEngineVersion === '') {
      throw new Error('desktop update: invalid packaged dshEngineVersion')
    }
    return manifest.dshEngineVersion
  }
  if ('version' in manifest && typeof manifest.version === 'string' && manifest.version !== '') {
    return manifest.version
  }
  return undefined
}

/**
 * Read the GitHub release repository URL (`dshReleaseRepository`) sealed into the packaged application manifest.
 * @param manifest - Parsed application manifest.
 * @returns Canonical HTTPS GitHub repository URL (`https://github.com/<owner>/<repo>`), or `undefined` when omitted.
 */
export function desktopReleaseRepository(manifest: unknown): string | undefined {
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw new Error('desktop update: invalid application manifest')
  }
  if (!('dshReleaseRepository' in manifest) || manifest.dshReleaseRepository === undefined) {
    return undefined
  }
  if (typeof manifest.dshReleaseRepository !== 'string') {
    throw new Error('desktop update: invalid packaged dshReleaseRepository')
  }
  assertIsolatedUpdaterRequestTarget({ url: manifest.dshReleaseRepository.trim() })
  const parsed = parseGitHubReleaseRepository(manifest.dshReleaseRepository)
  if (parsed === undefined) {
    throw new Error('desktop update: invalid packaged dshReleaseRepository')
  }
  return parsed.repositoryUrl
}
