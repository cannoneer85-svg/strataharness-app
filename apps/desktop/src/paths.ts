/** Filesystem ownership for the Electron-managed desktop installation. */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { DSH_HOME_ENV, resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** Default user-data directory name for StrataHarness under the OS home, isolated from upstream `.dsh`. */
export const STRATA_HOME_DIR_NAME = '.strataharness'

/** Stable desktop installation paths under the shared Harness home. */
export interface DesktopPaths {
  readonly profile: string
  readonly lock: string
}

/**
 * Resolve every Electron-owned path and pin `DSH_HOME` to `~/.strataharness` when unset so Desktop and Host stay isolated from `~/.dsh`.
 * @param dshHome - Explicit Harness home override; when omitted, reads `DSH_HOME` or defaults to `~/.strataharness`.
 * @returns immutable desktop path set.
 */
export function resolveDesktopPaths(dshHome?: string): DesktopPaths {
  if (dshHome === undefined) {
    const configured = process.env[DSH_HOME_ENV]
    if (configured === undefined || configured.trim().length === 0) {
      process.env[DSH_HOME_ENV] = join(homedir(), STRATA_HOME_DIR_NAME)
    }
  }
  const resolved = resolveDshHome(dshHome)
  return {
    profile: join(resolved, 'profiles', 'desktop'),
    lock: join(resolved, 'profiles', 'desktop', 'lock'),
  }
}
