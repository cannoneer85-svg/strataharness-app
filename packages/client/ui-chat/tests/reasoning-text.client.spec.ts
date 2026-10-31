import { describe, expect, it } from 'vitest'
import { reasoningText } from '../src/client/reasoning-text.ts'

describe('reasoning display text', () => {
  it.each([
    '',
    'Ordinary reasoning',
    '普通思考正文',
    '\n  Original text  \n',
    '<note>Original text</note>',
    '<span>Hello</span>',
  ])('preserves ordinary reasoning %j', (text) => {
    expect(reasoningText(text)).toBe(text)
  })

  it.each([
    '<',
    '<s',
    '<sig',
    '<signature',
    '<signature>',
  ])('returns empty text while streaming opening signature tag %j', (text) => {
    expect(reasoningText(text)).toBe('')
  })

  it('returns empty text while streaming content inside unclosed signature tag', () => {
    expect(reasoningText('<signature>in-progress signature content...')).toBe('')
  })

  it.each([
    ['<signature>sig_abc</signature>Pure reasoning text', 'Pure reasoning text'],
    ['<signature>sig_abc</signature>\nLeading newline reasoning', 'Leading newline reasoning'],
    ['<signature>sig_abc</signature>\r\nLeading CRLF reasoning', 'Leading CRLF reasoning'],
    ['<signature>sig_abc</signature>\n\r\n\nMultiple newlines', 'Multiple newlines'],
    ['<signature>sig_abc</signature>', ''],
  ])('strips complete signature tag and trims leading line breaks %j', (input, expected) => {
    expect(reasoningText(input)).toBe(expected)
  })
})
