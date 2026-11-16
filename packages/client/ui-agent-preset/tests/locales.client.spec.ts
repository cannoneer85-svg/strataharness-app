/** Web-localized copy for shipped presets (upstream and Strata roles) and declared copy for every other row. */

import { describe, expect, it } from 'vitest'
import { en, ja, isBuiltInPreset, presetDisplayText, ru, zh } from '../src/client/locales.ts'

const translate = (bundle: typeof en) => (key: keyof typeof en): string => bundle[key]

describe('preset display copy', () => {
  it.each([
    ['standard', 'presetStandardName', 'presetStandardDescription'],
    ['ptc', 'presetPtcName', 'presetPtcDescription'],
    ['minimal', 'presetMinimalName', 'presetMinimalDescription'],
    ['cordis', 'presetCordisName', 'presetCordisDescription'],
    ['strata', 'presetStrataName', 'presetStrataDescription'],
    ['strata-developer', 'presetStrataDeveloperName', 'presetStrataDeveloperDescription'],
    ['strata-analyst', 'presetStrataAnalystName', 'presetStrataAnalystDescription'],
    ['strata-designer', 'presetStrataDesignerName', 'presetStrataDesignerDescription'],
  ] as const)('localizes the shipped %s preset across English, Chinese, Japanese, and Russian', (id, nameKey, descriptionKey) => {
    const preset = { id }

    expect(isBuiltInPreset(preset)).toBe(true)
    expect(presetDisplayText(preset, translate(en)))
      .toEqual({ name: en[nameKey], description: en[descriptionKey] })
    expect(presetDisplayText(preset, translate(zh)))
      .toEqual({ name: zh[nameKey], description: zh[descriptionKey] })
    expect(presetDisplayText(preset, translate(ja)))
      .toEqual({ name: ja[nameKey], description: ja[descriptionKey] })
    expect(presetDisplayText(preset, translate(ru)))
      .toEqual({ name: ru[nameKey], description: ru[descriptionKey] })
  })

  it.each([
    ['strata', 'StrataHarness'],
    ['strata-developer', 'Strata Developer'],
    ['strata-analyst', 'Strata Analyst'],
    ['strata-designer', 'Strata Designer'],
  ] as const)('preserves recognizable role name %s -> %s across locales while localizing descriptions', (id, expectedName) => {
    const enCopy = presetDisplayText({ id }, translate(en))
    const zhCopy = presetDisplayText({ id }, translate(zh))

    expect(enCopy.name).toBe(expectedName)
    expect(zhCopy.name).toBe(expectedName)
    expect(enCopy.description).toBeTruthy()
    expect(zhCopy.description).toBeTruthy()
    expect(zhCopy.description).not.toBe(enCopy.description)
  })

  it('keeps declared metadata untranslated for named and unknown presets', () => {
    const fileCopy = { name: '我的标准', description: '团队自己的 preset。' }

    expect(presetDisplayText({ id: 'standard', ...fileCopy }, translate(en)))
      .toEqual(fileCopy)
    expect(presetDisplayText({ id: 'deployment-extra', ...fileCopy }, translate(en)))
      .toEqual(fileCopy)
    expect(presetDisplayText({ id: 'bare' }, translate(en)))
      .toEqual({ name: 'bare' })
  })
})
