/**
 * Dictionary template interpolation supporting `{name}` placeholders and
 * compact ICU `{name, plural, =0 {...} one {...} few {...} many {...} other {...}}`
 * blocks evaluated against standard `Intl.PluralRules`.
 */

const SIMPLE_PLACEHOLDER = /^\w+$/u
const PLURAL_HEADER = /^\s*(\w+)\s*,\s*plural\s*,\s*/u
const PLURAL_SELECTOR = /^(?:=\d+|zero|one|two|few|many|other)\b/u

function findClosingBrace(source: string, openIndex: number): number {
  let depth = 1
  for (let i = openIndex + 1; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function parsePluralBranches(body: string): ReadonlyMap<string, string> | undefined {
  const branches = new Map<string, string>()
  let cursor = 0
  while (cursor < body.length) {
    while (cursor < body.length && /\s/u.test(body.charAt(cursor))) cursor += 1
    if (cursor >= body.length) break
    const selectorMatch = PLURAL_SELECTOR.exec(body.slice(cursor))
    if (selectorMatch === null) return undefined
    const selector = selectorMatch[0]
    cursor += selector.length
    while (cursor < body.length && /\s/u.test(body.charAt(cursor))) cursor += 1
    if (body[cursor] !== '{') return undefined
    const closeIndex = findClosingBrace(body, cursor)
    /* v8 ignore next -- outer findClosingBrace already balanced the enclosing plural block */
    if (closeIndex < 0) return undefined
    branches.set(selector, body.slice(cursor + 1, closeIndex))
    cursor = closeIndex + 1
  }
  return branches.size > 0 ? branches : undefined
}

function resolveNumericParam(raw: unknown): number {
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string' && raw.trim() !== '') return Number(raw)
  return Number.NaN
}

function renderSegment(
  segment: string,
  params: Readonly<Record<string, unknown>>,
  selectPlural: (value: number) => Intl.LDMLPluralRule,
  hashValue?: string,
): string {
  let output = ''
  let index = 0
  while (index < segment.length) {
    const ch = segment.charAt(index)
    if (hashValue !== undefined && ch === '#') {
      output += hashValue
      index += 1
      continue
    }
    if (ch !== '{') {
      output += ch
      index += 1
      continue
    }
    const closeIndex = findClosingBrace(segment, index)
    if (closeIndex < 0) {
      output += segment.slice(index)
      break
    }
    const raw = segment.slice(index, closeIndex + 1)
    const expr = segment.slice(index + 1, closeIndex)
    index = closeIndex + 1
    if (SIMPLE_PLACEHOLDER.test(expr)) {
      output += Object.hasOwn(params, expr) ? String(params[expr]) : raw
      continue
    }
    const header = PLURAL_HEADER.exec(expr)
    if (header === null) {
      output += raw
      continue
    }
    const paramName = String(header[1])
    const branches = parsePluralBranches(expr.slice(header[0].length))
    if (branches === undefined || !Object.hasOwn(params, paramName)) {
      output += raw
      continue
    }
    const numeric = resolveNumericParam(params[paramName])
    if (!Number.isFinite(numeric)) {
      output += raw
      continue
    }
    const chosen = branches.get(`=${String(numeric)}`)
      ?? branches.get(selectPlural(numeric))
      ?? branches.get('other')
    if (chosen === undefined) {
      output += raw
      continue
    }
    output += renderSegment(chosen, params, selectPlural, String(numeric))
  }
  return output
}

/**
 * Format a dictionary template with `{name}` placeholders and compact ICU
 * `{name, plural, =0 {...} one {...} few {...} many {...} other {...}}` blocks.
 * @param template - Raw localized template string.
 * @param params - Parameter bag supplied to the bound translate function.
 * @param selectPlural - Plural category selector (`Intl.PluralRules.select`) for the template's locale.
 * @returns Formatted localized string with unknown or malformed expressions preserved verbatim.
 */
export function interpolateTemplate(
  template: string,
  params: Readonly<Record<string, unknown>>,
  selectPlural: (value: number) => Intl.LDMLPluralRule,
): string {
  return renderSegment(template, params, selectPlural)
}
