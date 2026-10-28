import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveDesktopPaths, STRATA_HOME_DIR_NAME } from '../src/paths.ts'

const originalDshHome = process.env.DSH_HOME

afterEach(() => {
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
})

describe('resolveDesktopPaths', () => {
  it('pins DSH_HOME to ~/.strataharness when unset or blank so StrataHarness never collides with ~/.dsh', () => {
    delete process.env.DSH_HOME
    const expectedHome = join(homedir(), STRATA_HOME_DIR_NAME)
    expect(resolveDesktopPaths()).toEqual({
      profile: join(expectedHome, 'profiles', 'desktop'),
      lock: join(expectedHome, 'profiles', 'desktop', 'lock'),
    })
    expect(process.env.DSH_HOME).toBe(expectedHome)

    process.env.DSH_HOME = '   '
    expect(resolveDesktopPaths().profile).toBe(join(expectedHome, 'profiles', 'desktop'))
    expect(process.env.DSH_HOME).toBe(expectedHome)
  })

  it('preserves an explicit DSH_HOME environment variable or argument override', () => {
    const envHome = join(homedir(), 'custom-strata-env-home')
    process.env.DSH_HOME = envHome
    expect(resolveDesktopPaths().profile).toBe(join(envHome, 'profiles', 'desktop'))
    expect(process.env.DSH_HOME).toBe(envHome)

    const argHome = join(homedir(), 'custom-strata-arg-home')
    expect(resolveDesktopPaths(argHome).profile).toBe(join(argHome, 'profiles', 'desktop'))
    expect(process.env.DSH_HOME).toBe(envHome)
  })
})
