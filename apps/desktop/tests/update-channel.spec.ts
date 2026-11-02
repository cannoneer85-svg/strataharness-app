import { describe, expect, it } from 'vitest'
import {
  desktopEngineVersion,
  desktopReleaseRepository,
  desktopUpdateChannel,
  parseGitHubReleaseRepository,
} from '../src/update-channel.ts'

describe('desktop update channel and release repository manifest metadata', () => {
  it('reads the installed channel independently from the current version', () => {
    expect(desktopUpdateChannel({ version: '1.0.0', dshDesktopUpdateChannel: 'nightly' })).toBe('nightly')
    expect(desktopUpdateChannel({ version: '1.0.0', dshDesktopUpdateChannel: 'latest' })).toBe('latest')
    expect(desktopUpdateChannel({ version: '1.0.0' })).toBe('nightly')
    expect(() => desktopUpdateChannel({ dshDesktopUpdateChannel: 'beta' })).toThrow(/channel/u)
    expect(() => desktopUpdateChannel(null)).toThrow(/manifest/u)
  })

  it('reads the bundled DSH engine version or falls back to manifest.version', () => {
    expect(desktopEngineVersion({ version: '1.0.1', dshEngineVersion: '0.2.1-rc.5' })).toBe('0.2.1-rc.5')
    expect(desktopEngineVersion({ version: '0.2.1-rc.5' })).toBe('0.2.1-rc.5')
    expect(desktopEngineVersion({})).toBeUndefined()
    expect(() => desktopEngineVersion({ dshEngineVersion: '' })).toThrow(/dshEngineVersion/u)
  })

  it('parses and validates isolated HTTPS GitHub release repository URLs', () => {
    expect(parseGitHubReleaseRepository('https://github.com/cannoneer85-svg/strataharness-app.git')).toEqual({
      owner: 'cannoneer85-svg',
      repo: 'strataharness-app',
      repositoryUrl: 'https://github.com/cannoneer85-svg/strataharness-app',
    })
    expect(parseGitHubReleaseRepository(' https://github.com/cannoneer85-svg/strataharness-app/ ')).toEqual({
      owner: 'cannoneer85-svg',
      repo: 'strataharness-app',
      repositoryUrl: 'https://github.com/cannoneer85-svg/strataharness-app',
    })

    for (const invalid of [
      '',
      '   ',
      'http://github.com/cannoneer85-svg/strataharness-app.git',
      'https://gitlab.com/cannoneer85-svg/strataharness-app.git',
      'https://download.deepseek.com/cannoneer85-svg/strataharness-app.git',
      'https://github.com/deepseek-ai/deepseek-harness.git',
      'https://github.com/deepseek-ai/deepseek-harness',
      'https://github.com/only-owner',
      'https://github.com/cannoneer85-svg/strataharness-app?tab=releases',
    ]) {
      expect(parseGitHubReleaseRepository(invalid), `invalid=${invalid}`).toBeUndefined()
    }
  })

  it('extracts dshReleaseRepository from the application manifest and rejects invalid or upstream targets', () => {
    expect(desktopReleaseRepository({ version: '1.0.1' })).toBeUndefined()
    expect(
      desktopReleaseRepository({
        version: '1.0.1',
        dshReleaseRepository: 'https://github.com/cannoneer85-svg/strataharness-app.git',
      }),
    ).toBe('https://github.com/cannoneer85-svg/strataharness-app')

    expect(() => desktopReleaseRepository(null)).toThrow(/manifest/u)
    expect(() => desktopReleaseRepository({ dshReleaseRepository: '' })).toThrow(/dshReleaseRepository/u)
    expect(() =>
      desktopReleaseRepository({
        dshReleaseRepository: 'https://github.com/deepseek-ai/deepseek-harness.git',
      }),
    ).toThrow(/dshReleaseRepository/u)
    expect(() =>
      desktopReleaseRepository({
        dshReleaseRepository: 'https://download.deepseek.com/dsh-desk',
      }),
    ).toThrow(/DeepSeek update domains are blocked/u)
  })
})
