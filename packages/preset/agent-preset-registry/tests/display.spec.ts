/**
 * Display resolution: shipped presets resolve through dictionary keys, and
 * user-authored metadata is never translated.
 */

import { describe, expect, it } from 'vitest'
import { isBuiltInPreset, presetDisplayText, type BuiltInPresetCopyKey } from '../src/display.ts'

const t = (key: BuiltInPresetCopyKey): string => `t:${key}`

describe('presetDisplayText', () => {
  it.each([
    ['standard', 'presetStandardName', 'presetStandardDescription'],
    ['ptc', 'presetPtcName', 'presetPtcDescription'],
    ['minimal', 'presetMinimalName', 'presetMinimalDescription'],
    ['cordis', 'presetCordisName', 'presetCordisDescription'],
    ['strata', 'presetStrataName', 'presetStrataDescription'],
    ['strata-developer', 'presetStrataDeveloperName', 'presetStrataDeveloperDescription'],
    ['strata-analyst', 'presetStrataAnalystName', 'presetStrataAnalystDescription'],
    ['strata-designer', 'presetStrataDesignerName', 'presetStrataDesignerDescription'],
  ] as const)('resolves shipped preset %s through its dictionary keys', (id, nameKey, descriptionKey) => {
    expect(isBuiltInPreset({ id })).toBe(true)
    expect(isBuiltInPreset({ id, name: 'Overridden' })).toBe(false)
    expect(presetDisplayText({ id }, t)).toEqual({
      name: `t:${nameKey}`,
      description: `t:${descriptionKey}`,
    })
  })

  it('keeps user-authored metadata untranslated', () => {
    expect(presetDisplayText({ id: 'mine', name: '我的模式', description: '自述' }, t))
      .toEqual({ name: '我的模式', description: '自述' })
  })

  it('falls back to the id for a preset publishing no metadata', () => {
    // A system id outside the shipped set behaves like authored metadata:
    // there is no dictionary copy to resolve.
    expect(presetDisplayText({ id: 'future' }, t)).toEqual({ name: 'future' })
    expect(presetDisplayText({ id: 'bare' }, t)).toEqual({ name: 'bare' })
  })
})
