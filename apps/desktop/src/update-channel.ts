/** Resolve the update channel sealed into the installed application manifest. */

/** Installer-owned channel, independent of release version and upload environment. */
export type DesktopUpdateChannel = 'nightly' | 'latest'

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
