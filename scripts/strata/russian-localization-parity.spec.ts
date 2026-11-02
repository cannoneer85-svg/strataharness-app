/**
 * Repository-wide 100% Russian localization parity gate for StrataHarness.
 *
 * Verifies four Soft-Fork invariants against the live workspace and proves
 * failure detection with negative cases:
 * 1. Every `LocaleNamespaceMap` member (plus `directory-browser`) has a
 *    registered `ru` dictionary in `@strata/locale-ru` with exact `en` key
 *    set equality, non-empty copy, and matching `{placeholder}` parameters.
 * 2. Electron Desktop `apps/desktop/src/locale.ts` maintains 100% `ru`/`en`
 *    key and `{placeholder}` parity and defaults startup resolution to `ru`.
 * 3. Every built-in plugin `locale/en.json` (including nested `locale/` paths) across `packages/` and `vendor/`
 *    (including synthesized `package.json#description` fallbacks) and every
 *    entry in `OFFICIAL_ON_DEMAND_CATALOG` resolves to a non-empty Russian
 *    translation via direct `locale/ru.json` or `ruPluginMetadataCatalog`.
 * 4. `@strata/product-bundle/cordis.patch.yml` mounts `@strata/locale-ru`,
 *    configures `defaultLocale: 'ru'` and `localeOrder: ['ru', 'en', 'zh']`,
 *    and boots `LocaleRuntime` into `active === 'ru'` with selector order
 *    `['Русский', 'English', '中文']` when `locale.preference` is unset.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { LocalizedText } from '@deepseek-ai/dsh-package-manifest'
import * as yaml from 'js-yaml'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import * as desktopLocale from '../../apps/desktop/src/locale.ts'
import { OFFICIAL_ON_DEMAND_CATALOG } from '../../packages/boot/app-boot/src/official-bundles.generated.ts'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const IGNORED_DIRS = new Set(['node_modules', 'lib', 'dist', 'tests', '.git'])
const EXTRA_UNTYPED_NAMESPACES = ['directory-browser'] as const
const INTENTIONAL_LATIN_TITLES = new Set(['DSH', 'StrataHarness'])
/** Russian digit grouping uses a space separator (`1 234 567`) where English uses `,`. */
const WHITESPACE_VALID_CLIENT_KEYS = new Set(['chat:number.groupSeparator'])
const SIMPLE_PLACEHOLDER = /^\w+$/u
const PLURAL_HEADER = /^\s*(\w+)\s*,\s*plural\s*,\s*/u
const PLURAL_SELECTOR = /^(?:=\d+|zero|one|two|few|many|other)\b/u

/** Localized title and description pair discovered from a plugin manifest or official bundle catalog. */
export interface DiscoveredMetadataItem {
  /** Repository-relative `locale/en.json` path or `official-bundle:<pkg>` identifier. */
  readonly source: string
  /** Localized title map when declared. */
  readonly title?: Readonly<Record<string, string>> & { readonly en: string }
  /** Localized description map when declared or synthesized from `package.json#description`. */
  readonly description?: Readonly<Record<string, string>> & { readonly en: string }
}

/** Parsed locale deployment facts from `packages/strata/product-bundle/cordis.patch.yml`. */
export interface ProductBundleLocalePatch {
  /** True when the patch inserts `@strata/locale-ru`. */
  readonly hasLocaleRuInsert: boolean
  /** Configured `defaultLocale` on the `locale` entry. */
  readonly defaultLocale: unknown
  /** Configured `localeOrder` on the `locale` entry. */
  readonly localeOrder: unknown
}

/** Snapshot facts observed after booting `LocaleRuntime` with `@strata/locale-ru`. */
export interface BootedLocaleContractSnapshot {
  /** Active locale identifier when `locale.preference` is unset. */
  readonly active: string
  /** Ordered locale identifiers exposed to `Settings -> General -> Language`. */
  readonly localeIds: readonly string[]
  /** Ordered self-described locale labels exposed to `Settings -> General -> Language`. */
  readonly localeLabels: readonly string[]
}

/** Complete input evaluated by {@link evaluateRussianLocalizationParity}. */
export interface RussianParityInput {
  /** Required client namespaces (`LocaleNamespaceMap` union plus `directory-browser`). */
  readonly requiredNamespaces: ReadonlySet<string>
  /** Canonical English dictionaries discovered across `packages/`. */
  readonly englishNamespaces: ReadonlyMap<string, Readonly<Record<string, string>>>
  /** Russian dictionaries registered by `@strata/locale-ru`. */
  readonly russianNamespaces: ReadonlyMap<string, Readonly<Record<string, string>>>
  /** Canonical English Electron Desktop dictionary. */
  readonly desktopEnglish: Readonly<Record<string, string>>
  /** Russian Electron Desktop dictionary. */
  readonly desktopRussian: Readonly<Record<string, string>>
  /** Resolved Electron Desktop startup locale id when `preference` is `null`. */
  readonly desktopStartupLocaleId: string
  /** Built-in plugin metadata and official on-demand bundle metadata items. */
  readonly pluginMetadata: readonly DiscoveredMetadataItem[]
  /** Centralized `en -> ru` `LocalizedText` catalog registered by `@strata/locale-ru`. */
  readonly metadataCatalog: Readonly<Record<string, string>>
  /** Active `LocaleRuntime.resolveText` resolver under `'ru'`. */
  readonly resolveLocalizedText: (text: LocalizedText) => string
  /** Parsed `@strata/product-bundle/cordis.patch.yml` locale contract. */
  readonly productBundlePatch: ProductBundleLocalePatch
  /** Booted `LocaleRuntime` snapshot under unset user preference and non-Russian browser languages. */
  readonly bootedLocaleSnapshot: BootedLocaleContractSnapshot
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function findClosingBrace(source: string, openIndex: number): number {
  let depth = 1
  for (let index = openIndex + 1; index < source.length; index += 1) {
    const ch = source[index]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

/**
 * Extract sorted `{param}` and `{param, plural, ...}` variable names consumed by `LocaleRuntime` interpolation.
 * @param template - Client UI dictionary template string.
 * @returns Sorted unique placeholder parameter names.
 */
export function extractClientTemplateParameters(template: string): string[] {
  const names = new Set<string>()
  const collect = (segment: string): void => {
    let cursor = 0
    while (cursor < segment.length) {
      if (segment[cursor] !== '{') {
        cursor += 1
        continue
      }
      const closeIndex = findClosingBrace(segment, cursor)
      if (closeIndex < 0) break
      const expr = segment.slice(cursor + 1, closeIndex)
      cursor = closeIndex + 1
      if (SIMPLE_PLACEHOLDER.test(expr)) {
        names.add(expr)
        continue
      }
      const header = PLURAL_HEADER.exec(expr)
      if (header !== null && header[1] !== undefined) {
        names.add(header[1])
        const body = expr.slice(header[0].length)
        let branchCursor = 0
        while (branchCursor < body.length) {
          while (branchCursor < body.length && /\s/u.test(body.charAt(branchCursor))) branchCursor += 1
          if (branchCursor >= body.length) break
          const selector = PLURAL_SELECTOR.exec(body.slice(branchCursor))
          if (selector === null) break
          branchCursor += selector[0].length
          while (branchCursor < body.length && /\s/u.test(body.charAt(branchCursor))) branchCursor += 1
          if (body[branchCursor] !== '{') break
          const branchClose = findClosingBrace(body, branchCursor)
          if (branchClose < 0) break
          collect(body.slice(branchCursor + 1, branchClose))
          branchCursor = branchClose + 1
        }
      }
    }
  }
  collect(template)
  return [...names].sort()
}

function extractDesktopPlaceholders(template: string): string[] {
  const names = new Set<string>()
  for (const match of template.matchAll(/\{([^{}]+)\}/gu)) {
    if (match[1] !== undefined) names.add(match[1])
  }
  return [...names].sort()
}

/**
 * Evaluate all four Russian localization parity invariants and return human-readable violations.
 * @param input - Discovered workspace dictionaries, metadata items, patch config, and booted runtime snapshot.
 * @returns Empty array when 100% parity holds; otherwise one diagnostic string per violation.
 */
export function evaluateRussianLocalizationParity(input: RussianParityInput): string[] {
  const violations: string[] = []

  // (a) 100% Client UI namespace & key parity
  const allNamespaces = new Set<string>([
    ...input.requiredNamespaces,
    ...input.englishNamespaces.keys(),
    ...input.russianNamespaces.keys(),
  ])
  for (const ns of [...allNamespaces].sort()) {
    const enDict = input.englishNamespaces.get(ns)
    const ruDict = input.russianNamespaces.get(ns)
    if (enDict === undefined) {
      violations.push(`client namespace "${ns}": missing canonical English dictionary`)
      continue
    }
    if (ruDict === undefined) {
      violations.push(`client namespace "${ns}": missing Russian dictionary registration in @strata/locale-ru`)
      continue
    }

    const enKeys = Object.keys(enDict).sort()
    const ruKeys = Object.keys(ruDict).sort()
    const missingInRu = enKeys.filter(key => !Object.hasOwn(ruDict, key))
    const extraInRu = ruKeys.filter(key => !Object.hasOwn(enDict, key))
    if (missingInRu.length > 0) {
      violations.push(`client namespace "${ns}": missing Russian key(s): ${missingInRu.join(', ')}`)
    }
    if (extraInRu.length > 0) {
      violations.push(`client namespace "${ns}": extra Russian key(s) absent from English: ${extraInRu.join(', ')}`)
    }

    for (const key of enKeys) {
      if (!Object.hasOwn(ruDict, key)) continue
      const enVal = enDict[key]
      const ruVal = ruDict[key]
      if (typeof enVal !== 'string' || typeof ruVal !== 'string') {
        violations.push(`client namespace "${ns}" key "${key}": dictionary value must be a string`)
        continue
      }
      const allowsWhitespaceValue = WHITESPACE_VALID_CLIENT_KEYS.has(`${ns}:${key}`)
      const isEmptyRu = allowsWhitespaceValue ? ruVal.length === 0 : ruVal.trim().length === 0
      if (enVal.trim().length > 0 && isEmptyRu) {
        violations.push(`client namespace "${ns}" key "${key}": Russian translation must not be empty`)
      }
      const enParams = extractClientTemplateParameters(enVal)
      const ruParams = extractClientTemplateParameters(ruVal)
      if (enParams.join(',') !== ruParams.join(',')) {
        violations.push(
          `client namespace "${ns}" key "${key}": placeholder mismatch (en: [${enParams.join(', ')}], ru: [${ruParams.join(', ')}])`,
        )
      }
    }
  }

  // (b) Electron Desktop shell dictionary parity
  const desktopEnKeys = Object.keys(input.desktopEnglish).sort()
  const desktopRuKeys = Object.keys(input.desktopRussian).sort()
  const desktopMissingInRu = desktopEnKeys.filter(key => !Object.hasOwn(input.desktopRussian, key))
  const desktopExtraInRu = desktopRuKeys.filter(key => !Object.hasOwn(input.desktopEnglish, key))
  if (desktopMissingInRu.length > 0) {
    violations.push(`desktop locale: missing Russian key(s): ${desktopMissingInRu.join(', ')}`)
  }
  if (desktopExtraInRu.length > 0) {
    violations.push(`desktop locale: extra Russian key(s) absent from English: ${desktopExtraInRu.join(', ')}`)
  }
  for (const key of desktopEnKeys) {
    if (!Object.hasOwn(input.desktopRussian, key)) continue
    const enVal = input.desktopEnglish[key]
    const ruVal = input.desktopRussian[key]
    if (typeof enVal !== 'string' || typeof ruVal !== 'string') {
      violations.push(`desktop locale key "${key}": value must be a string`)
      continue
    }
    if (enVal.trim().length > 0 && ruVal.trim().length === 0) {
      violations.push(`desktop locale key "${key}": Russian translation must not be empty`)
    }
    const enTokens = extractDesktopPlaceholders(enVal)
    const ruTokens = extractDesktopPlaceholders(ruVal)
    if (enTokens.join(',') !== ruTokens.join(',')) {
      violations.push(
        `desktop locale key "${key}": placeholder mismatch (en: [${enTokens.join(', ')}], ru: [${ruTokens.join(', ')}])`,
      )
    }
  }
  if (input.desktopStartupLocaleId !== 'ru') {
    violations.push(`desktop startup locale: expected "ru", got ${JSON.stringify(input.desktopStartupLocaleId)}`)
  }

  // (c) 100% Built-in plugin metadata & official on-demand bundle coverage
  for (const item of input.pluginMetadata) {
    for (const field of ['title', 'description'] as const) {
      const record = item[field]
      if (record === undefined) continue
      const directRu = record.ru
      const catalogRu = Object.hasOwn(input.metadataCatalog, record.en)
        ? input.metadataCatalog[record.en]
        : undefined
      const effectiveRu = directRu ?? catalogRu
      if (effectiveRu === undefined || effectiveRu.trim().length === 0) {
        violations.push(`${item.source} (${field}): missing Russian translation for ${JSON.stringify(record.en)}`)
        continue
      }
      const resolved = input.resolveLocalizedText(record)
      if (resolved.trim().length === 0) {
        violations.push(`${item.source} (${field}): LocaleRuntime.resolveText returned empty string`)
        continue
      }
      if (!INTENTIONAL_LATIN_TITLES.has(record.en) && !/[А-Яа-яЁё]/u.test(resolved)) {
        violations.push(`${item.source} (${field}): resolved translation lacks Cyrillic characters: ${JSON.stringify(resolved)}`)
      }
    }
  }

  // (d) Product default & ordering contract
  if (!input.productBundlePatch.hasLocaleRuInsert) {
    violations.push('packages/strata/product-bundle/cordis.patch.yml: missing @strata/locale-ru insert entry')
  }
  if (input.productBundlePatch.defaultLocale !== 'ru') {
    violations.push(
      `packages/strata/product-bundle/cordis.patch.yml: expected locale.config.defaultLocale === "ru", got ${JSON.stringify(input.productBundlePatch.defaultLocale)}`,
    )
  }
  const order = input.productBundlePatch.localeOrder
  if (!Array.isArray(order) || order.join(',') !== 'ru,en,zh') {
    violations.push(
      `packages/strata/product-bundle/cordis.patch.yml: expected locale.config.localeOrder === ["ru", "en", "zh"], got ${JSON.stringify(order)}`,
    )
  }
  if (input.bootedLocaleSnapshot.active !== 'ru') {
    violations.push(`LocaleRuntime default active locale: expected "ru", got ${JSON.stringify(input.bootedLocaleSnapshot.active)}`)
  }
  if (input.bootedLocaleSnapshot.localeIds.join(',') !== 'ru,en,zh') {
    violations.push(
      `LocaleRuntime locale id order: expected ["ru", "en", "zh"], got ${JSON.stringify(input.bootedLocaleSnapshot.localeIds)}`,
    )
  }
  if (input.bootedLocaleSnapshot.localeLabels.join(',') !== 'Русский,English,中文') {
    violations.push(
      `LocaleRuntime locale label order: expected ["Русский", "English", "中文"], got ${JSON.stringify(input.bootedLocaleSnapshot.localeLabels)}`,
    )
  }

  return violations
}

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) walkSourceFiles(join(dir, entry.name), out)
    } else if ((entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) && !entry.name.endsWith('.d.ts')) {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

function walkLocaleEnJsonFiles(dir: string, insideLocaleDir = false, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      walkLocaleEnJsonFiles(join(dir, entry.name), insideLocaleDir || entry.name === 'locale', out)
    } else if (insideLocaleDir && entry.isFile() && entry.name === 'en.json') {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

function unwrapExpression(expr: ts.Expression | undefined): ts.Expression | undefined {
  let current = expr
  while (
    current !== undefined
    && (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current))
  ) {
    current = current.expression
  }
  return current
}

function resolveRelativeTsModule(fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined
  const base = resolve(dirname(fromFile), specifier)
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]
  return candidates.find(candidate => existsSync(candidate) && statSync(candidate).isFile())
}

async function discoverClientNamespacesAndEnglishDictionaries(
  packagesRoot: string,
): Promise<{
  readonly typedNamespaces: Set<string>
  readonly englishNamespaces: Map<string, Readonly<Record<string, string>>>
}> {
  const files = walkSourceFiles(packagesRoot).sort()
  const sourceCache = new Map<string, ts.SourceFile>()
  const getSourceFile = (file: string): ts.SourceFile => {
    const cached = sourceCache.get(file)
    if (cached !== undefined) return cached
    const text = readFileSync(file, 'utf8')
    const parsed = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.ESNext,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    sourceCache.set(file, parsed)
    return parsed
  }

  const findImportTarget = (
    file: string,
    localName: string,
  ): { readonly file: string; readonly exportName: string } | undefined => {
    const sf = getSourceFile(file)
    for (const statement of sf.statements) {
      if (
        ts.isImportDeclaration(statement)
        && ts.isStringLiteral(statement.moduleSpecifier)
        && statement.importClause?.namedBindings !== undefined
        && ts.isNamedImports(statement.importClause.namedBindings)
      ) {
        for (const element of statement.importClause.namedBindings.elements) {
          if (element.name.text === localName) {
            const targetFile = resolveRelativeTsModule(file, statement.moduleSpecifier.text)
            if (targetFile === undefined) return undefined
            return {
              file: targetFile,
              exportName: element.propertyName !== undefined ? element.propertyName.text : element.name.text,
            }
          }
        }
      }
    }
    return undefined
  }

  const findVariableInitializer = (sf: ts.SourceFile, identName: string): ts.Expression | undefined => {
    let found: ts.Expression | undefined
    const visit = (node: ts.Node): void => {
      if (found !== undefined) return
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === identName && node.initializer !== undefined) {
        found = node.initializer
        return
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
    return found
  }

  const evaluateStringConstant = (file: string, expr: ts.Expression | undefined): string | undefined => {
    const unwrapped = unwrapExpression(expr)
    if (unwrapped === undefined) return undefined
    if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
      return unwrapped.text
    }
    if (ts.isIdentifier(unwrapped)) {
      const localInit = findVariableInitializer(getSourceFile(file), unwrapped.text)
      if (localInit !== undefined) return evaluateStringConstant(file, localInit)
      const imported = findImportTarget(file, unwrapped.text)
      if (imported !== undefined) {
        return evaluateStringConstant(
          imported.file,
          findVariableInitializer(getSourceFile(imported.file), imported.exportName),
        )
      }
    }
    return undefined
  }

  const extractInlineStringDictionary = (expr: ts.Expression | undefined): Record<string, string> | undefined => {
    const unwrapped = unwrapExpression(expr)
    if (unwrapped === undefined || !ts.isObjectLiteralExpression(unwrapped)) return undefined
    const dict: Record<string, string> = {}
    for (const prop of unwrapped.properties) {
      if (
        ts.isPropertyAssignment(prop)
        && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
        && (ts.isStringLiteral(prop.initializer) || ts.isNoSubstitutionTemplateLiteral(prop.initializer))
      ) {
        dict[prop.name.text] = prop.initializer.text
      } else {
        return undefined
      }
    }
    return dict
  }

  const typedNamespaces = new Set<string>()
  const englishNamespaces = new Map<string, Readonly<Record<string, string>>>()
  const localeRuPrefix = join(packagesRoot, 'strata', 'locale-ru')

  for (const file of files) {
    const rawText = readFileSync(file, 'utf8')
    if (rawText.includes('LocaleNamespaceMap')) {
      const sf = getSourceFile(file)
      const visitInterfaces = (node: ts.Node): void => {
        if (ts.isInterfaceDeclaration(node) && node.name.text === 'LocaleNamespaceMap') {
          for (const member of node.members) {
            if (
              ts.isPropertySignature(member)
              && member.name !== undefined
              && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))
            ) {
              typedNamespaces.add(member.name.text)
            }
          }
        }
        ts.forEachChild(node, visitInterfaces)
      }
      visitInterfaces(sf)
    }

    if (file.startsWith(localeRuPrefix) || !rawText.includes('.register(')) continue

    const sf = getSourceFile(file)
    const registerCalls: ts.CallExpression[] = []
    const visitCalls = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'register'
      ) {
        const receiver = node.expression.expression.getText(sf)
        if (receiver === 'locale' || receiver.endsWith('.locale')) {
          registerCalls.push(node)
        }
      }
      ts.forEachChild(node, visitCalls)
    }
    visitCalls(sf)

    for (const call of registerCalls) {
      const namespace = evaluateStringConstant(file, call.arguments[0])
      if (namespace === undefined) {
        throw new Error(`Russian parity gate: cannot resolve namespace argument in ${relative(REPO_ROOT, file)}`)
      }
      if (call.arguments.length === 2) {
        const objLiteral = unwrapExpression(call.arguments[1])
        if (objLiteral === undefined || !ts.isObjectLiteralExpression(objLiteral)) {
          throw new Error(`Russian parity gate: expected { zh, en } literal for "${namespace}" in ${relative(REPO_ROOT, file)}`)
        }
        for (const prop of objLiteral.properties) {
          const propName = prop.name !== undefined && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
            ? prop.name.text
            : undefined
          if (propName !== 'en') continue
          let identName: string | undefined
          if (ts.isShorthandPropertyAssignment(prop)) {
            identName = prop.name.text
          } else if (ts.isPropertyAssignment(prop)) {
            const unwrappedInit = unwrapExpression(prop.initializer)
            if (unwrappedInit !== undefined && ts.isIdentifier(unwrappedInit)) {
              identName = unwrappedInit.text
            } else {
              const inlineDict = extractInlineStringDictionary(prop.initializer)
              if (inlineDict === undefined) {
                throw new Error(`Russian parity gate: unsupported inline English dictionary for "${namespace}" in ${relative(REPO_ROOT, file)}`)
              }
              englishNamespaces.set(namespace, inlineDict)
              continue
            }
          }
          if (identName === undefined) {
            throw new Error(`Russian parity gate: cannot resolve English dictionary binding for "${namespace}" in ${relative(REPO_ROOT, file)}`)
          }
          const imported = findImportTarget(file, identName)
          const targetModulePath = imported !== undefined ? imported.file : file
          const targetExportName = imported !== undefined ? imported.exportName : identName
          const loadedModule = (await import(pathToFileURL(targetModulePath).href)) as Record<string, unknown>
          const loadedDict = loadedModule[targetExportName]
          if (!isPlainRecord(loadedDict)) {
            throw new Error(`Russian parity gate: "${targetExportName}" in ${relative(REPO_ROOT, targetModulePath)} is not a dictionary object`)
          }
          const normalized: Record<string, string> = {}
          for (const [key, value] of Object.entries(loadedDict)) {
            if (typeof value !== 'string') {
              throw new Error(`Russian parity gate: "${namespace}.${key}" in ${relative(REPO_ROOT, targetModulePath)} is not a string`)
            }
            normalized[key] = value
          }
          englishNamespaces.set(namespace, normalized)
        }
      } else if (call.arguments.length >= 3) {
        let matchedInline = false
        const findTupleDictionaries = (node: ts.Node): void => {
          if (ts.isArrayLiteralExpression(node)) {
            for (const element of node.elements) {
              if (
                ts.isArrayLiteralExpression(element)
                && element.elements.length === 2
                && element.elements[0] !== undefined
                && ts.isStringLiteral(element.elements[0])
                && element.elements[0].text === 'en'
              ) {
                const inlineDict = extractInlineStringDictionary(element.elements[1])
                if (inlineDict !== undefined) {
                  englishNamespaces.set(namespace, inlineDict)
                  matchedInline = true
                }
              }
            }
          }
          ts.forEachChild(node, findTupleDictionaries)
        }
        findTupleDictionaries(sf)
        if (!matchedInline) {
          throw new Error(`Russian parity gate: cannot resolve 3-arg English dictionary for "${namespace}" in ${relative(REPO_ROOT, file)}`)
        }
      }
    }
  }

  return { typedNamespaces, englishNamespaces }
}

function readJsonRecord(filePath: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
  if (!isPlainRecord(parsed)) {
    throw new Error(`Expected JSON object in ${filePath}`)
  }
  return parsed
}

function readLocaleMetaFields(filePath: string): { readonly title?: string; readonly description?: string } {
  const doc = readJsonRecord(filePath)
  const meta = isPlainRecord(doc.meta) ? doc.meta : undefined
  return {
    ...(typeof meta?.title === 'string' && meta.title.trim() !== '' ? { title: meta.title } : {}),
    ...(typeof meta?.description === 'string' && meta.description.trim() !== '' ? { description: meta.description } : {}),
  }
}

function buildLocalizedField(
  enValue: string | undefined,
  zhValue: string | undefined,
  ruValue: string | undefined,
): (Readonly<Record<string, string>> & { readonly en: string }) | undefined {
  if (enValue === undefined || enValue.trim() === '') return undefined
  return {
    en: enValue,
    ...(zhValue !== undefined && zhValue.trim() !== '' ? { zh: zhValue } : {}),
    ...(ruValue !== undefined && ruValue.trim() !== '' ? { ru: ruValue } : {}),
  }
}

function discoverAllPluginAndBundleMetadata(repoRoot: string): DiscoveredMetadataItem[] {
  const enJsonFiles = [
    ...walkLocaleEnJsonFiles(join(repoRoot, 'packages')),
    ...walkLocaleEnJsonFiles(join(repoRoot, 'vendor')),
  ].sort()

  const items: DiscoveredMetadataItem[] = enJsonFiles.map((enFile) => {
    const localeDir = dirname(enFile)
    const zhFile = join(localeDir, 'zh.json')
    const ruFile = join(localeDir, 'ru.json')
    const packageJsonPath = join(localeDir, '..', 'package.json')

    const enMeta = readLocaleMetaFields(enFile)
    const zhMeta = existsSync(zhFile) ? readLocaleMetaFields(zhFile) : undefined
    const ruMeta = existsSync(ruFile) ? readLocaleMetaFields(ruFile) : undefined
    const pkgRecord = existsSync(packageJsonPath) ? readJsonRecord(packageJsonPath) : undefined
    const pkgDescription = typeof pkgRecord?.description === 'string' && pkgRecord.description.trim() !== ''
      ? pkgRecord.description
      : undefined

    // Mirrors `readPluginMeta` in `packages/boot/app-boot/src/package-meta.ts`:
    // when a sibling locale (`zh.json` or `ru.json`) declares `meta.description`
    // while `en.json` omits it, `package.json#description` supplies `en`.
    const effectiveEnDescription = enMeta.description
      ?? (zhMeta?.description !== undefined || ruMeta?.description !== undefined ? pkgDescription : undefined)

    const title = buildLocalizedField(enMeta.title, zhMeta?.title, ruMeta?.title)
    const description = buildLocalizedField(effectiveEnDescription, zhMeta?.description, ruMeta?.description)

    return {
      source: relative(repoRoot, enFile).replaceAll('\\', '/'),
      ...(title === undefined ? {} : { title }),
      ...(description === undefined ? {} : { description }),
    }
  })

  for (const entry of OFFICIAL_ON_DEMAND_CATALOG) {
    const rawTitle = entry.meta.title
    const rawDescription = entry.meta.description
    const title = typeof rawTitle === 'string'
      ? { en: rawTitle }
      : rawTitle !== undefined
        ? { ...rawTitle, en: rawTitle.en }
        : undefined
    const description = typeof rawDescription === 'string'
      ? { en: rawDescription }
      : rawDescription !== undefined
        ? { ...rawDescription, en: rawDescription.en }
        : undefined
    items.push({
      source: `official-bundle:${entry.packageName}`,
      ...(title === undefined ? {} : { title }),
      ...(description === undefined ? {} : { description }),
    })
  }

  for (const plainItem of discoverPlainBuiltInYamlPluginMetadata(repoRoot)) {
    items.push(plainItem)
  }

  return items
}

function walkYamlFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      walkYamlFiles(join(dir, entry.name), out)
    } else if (entry.isFile() && /\.(?:yml|yaml)$/u.test(entry.name)) {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

function discoverPlainBuiltInYamlPluginMetadata(repoRoot: string): DiscoveredMetadataItem[] {
  const yamlFiles = walkYamlFiles(join(repoRoot, 'packages')).sort()
  const specifierOrigin = new Map<string, string>()
  const pattern = /name:\s*['"]?(@(?:deepseek-ai|strata)\/[a-z0-9._/-]+|cordis:[a-z0-9._/-]+)/gu
  for (const file of yamlFiles) {
    const content = readFileSync(file, 'utf8')
    for (const match of content.matchAll(pattern)) {
      const specifier = match[1]!.trim()
      if (/\.(?:yml|yaml|json)$/u.test(specifier)) continue
      if (!specifierOrigin.has(specifier)) specifierOrigin.set(specifier, file)
    }
  }

  const results: DiscoveredMetadataItem[] = []
  for (const [specifier, originFile] of [...specifierOrigin.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const req = createRequire(originFile)
    let hasLocaleEn = false
    try {
      req.resolve(`${specifier}/locale/en.json`)
      hasLocaleEn = true
    } catch (_missingLocaleEn) {
      // Built-in plugin specifier omits `locale/en.json`; `readPluginMeta` falls back to plain-string manifest fields.
    }
    if (hasLocaleEn) continue

    let description: string | undefined
    const isRootPackage = specifier.startsWith('@')
      ? specifier.split('/').length === 2
      : !specifier.includes('/')
    if (isRootPackage) {
      try {
        const pkgPath = req.resolve(`${specifier}/package.json`)
        const pkgRecord = readJsonRecord(pkgPath)
        if (typeof pkgRecord.description === 'string' && pkgRecord.description.trim() !== '') {
          description = pkgRecord.description
        }
      } catch (_missingManifest) {
        // Built-in virtual specifiers such as `cordis:group` carry no package.json manifest.
      }
    }

    results.push({
      source: `plain-builtin:${specifier}`,
      title: { en: specifier },
      ...(description === undefined ? {} : { description: { en: description } }),
    })
  }
  return results
}

function parseProductBundleLocalePatch(patchFilePath: string): ProductBundleLocalePatch {
  const parsed: unknown = yaml.load(readFileSync(patchFilePath, 'utf8'))
  if (!Array.isArray(parsed)) {
    throw new Error(`${patchFilePath} must parse to a YAML sequence`)
  }
  let defaultLocale: unknown
  let localeOrder: unknown
  let hasLocaleRuInsert = false

  for (const row of parsed) {
    if (!isPlainRecord(row)) continue
    if (row.id === 'locale' && isPlainRecord(row.config)) {
      defaultLocale = row.config.defaultLocale
      localeOrder = row.config.localeOrder
    }
    if (Array.isArray(row.insert)) {
      for (const inserted of row.insert) {
        if (isPlainRecord(inserted) && inserted.name === '@strata/locale-ru') {
          hasLocaleRuInsert = true
        }
      }
    }
  }

  return {
    hasLocaleRuInsert,
    defaultLocale,
    localeOrder,
  }
}

interface LoadedLocaleRuntime {
  register(
    ns: string,
    localeOrDicts: string | Record<string, Record<string, string>>,
    dict?: Record<string, string>,
  ): () => void
  getLocale(): {
    readonly active: string
    readonly locales: ReadonlyArray<{ readonly id: string; readonly label: string }>
  }
  resolveText(text: LocalizedText): string
}

interface LoadedLocaleRuntimeModule {
  readonly LocaleRuntime: new (
    ctx: Context,
    settings: undefined,
    initial: { readonly languages: readonly string[]; readonly preference: string | null },
    config: { readonly defaultLocale?: string | undefined; readonly localeOrder?: readonly string[] | undefined },
  ) => LoadedLocaleRuntime
}

interface LoadedLocaleRuClientModule {
  readonly apply: (ctx: Context) => void
}

interface LoadedPluginMetadataModule {
  readonly ruPluginMetadataCatalog: Readonly<Record<string, string>>
}

describe('StrataHarness 100% Russian localization parity gate', { timeout: 30_000 }, () => {
  it('enforces 100% client namespace/key parity, Electron Desktop parity, built-in plugin metadata coverage, and Russian default locale order', async () => {
    const { typedNamespaces, englishNamespaces } = await discoverClientNamespacesAndEnglishDictionaries(
      join(REPO_ROOT, 'packages'),
    )
    expect(typedNamespaces.size).toBeGreaterThanOrEqual(65)

    const requiredNamespaces = new Set<string>([...typedNamespaces, ...EXTRA_UNTYPED_NAMESPACES])
    expect(requiredNamespaces.size).toBeGreaterThanOrEqual(66)
    expect(englishNamespaces.size).toBe(requiredNamespaces.size)

    const patchPath = join(REPO_ROOT, 'packages', 'strata', 'product-bundle', 'cordis.patch.yml')
    const productBundlePatch = parseProductBundleLocalePatch(patchPath)

    // Dynamic file-URL imports keep the Host (`scripts/**`) and Client
    // (`packages/*/src/client/**`) TypeScript compiler faces decoupled.
    const localeRuntimeUrl = pathToFileURL(
      join(REPO_ROOT, 'packages', 'client', 'locale', 'src', 'client', 'index.ts'),
    ).href
    const localeRuClientUrl = pathToFileURL(
      join(REPO_ROOT, 'packages', 'strata', 'locale-ru', 'src', 'client', 'index.ts'),
    ).href
    const pluginMetadataUrl = pathToFileURL(
      join(REPO_ROOT, 'packages', 'strata', 'locale-ru', 'src', 'client', 'locales', 'plugin-metadata.ts'),
    ).href
    const { LocaleRuntime } = await (import(localeRuntimeUrl) as Promise<LoadedLocaleRuntimeModule>)
    const { apply: localeRuApply } = await (import(localeRuClientUrl) as Promise<LoadedLocaleRuClientModule>)
    const { ruPluginMetadataCatalog } = await (import(pluginMetadataUrl) as Promise<LoadedPluginMetadataModule>)

    const ctx = new Context()
    try {
      const locale = new LocaleRuntime(
        ctx,
        undefined,
        { languages: ['en-US', 'zh-CN'], preference: null },
        {
          defaultLocale: typeof productBundlePatch.defaultLocale === 'string'
            ? productBundlePatch.defaultLocale
            : undefined,
          localeOrder: Array.isArray(productBundlePatch.localeOrder)
            ? productBundlePatch.localeOrder.filter((item): item is string => typeof item === 'string')
            : undefined,
        },
      )

      for (const [namespace, enDict] of englishNamespaces) {
        locale.register(namespace, 'en', { ...enDict })
      }

      const russianNamespaces = new Map<string, Readonly<Record<string, string>>>()
      const originalRegister = locale.register.bind(locale)
      const interceptRegister: LoadedLocaleRuntime['register'] = (
        ns: string,
        localeOrDicts: string | Record<string, Record<string, string>>,
        dict?: Record<string, string>,
      ) => {
        if (typeof localeOrDicts === 'string') {
          if (localeOrDicts === 'ru' && dict !== undefined) {
            russianNamespaces.set(ns, dict)
          }
          return originalRegister(ns, localeOrDicts, dict ?? {})
        }
        return originalRegister(ns, localeOrDicts)
      }
      locale.register = interceptRegister

      ctx.provide('locale', locale)
      await ctx.plugin({ inject: ['locale'], apply: localeRuApply }).await()

      const snapshot = locale.getLocale()
      const pluginMetadata = discoverAllPluginAndBundleMetadata(REPO_ROOT)
      expect(pluginMetadata.length).toBeGreaterThanOrEqual(232)
      expect(Object.keys(desktopLocale.en).length).toBeGreaterThanOrEqual(167)

      const parityInput: RussianParityInput = {
        requiredNamespaces,
        englishNamespaces,
        russianNamespaces,
        desktopEnglish: desktopLocale.en,
        desktopRussian: desktopLocale.ru,
        desktopStartupLocaleId: desktopLocale.resolveDesktopStartupLocale(null, ['en-US', 'zh-CN']).id,
        pluginMetadata,
        metadataCatalog: ruPluginMetadataCatalog,
        resolveLocalizedText: text => locale.resolveText(text),
        productBundlePatch,
        bootedLocaleSnapshot: {
          active: snapshot.active,
          localeIds: snapshot.locales.map(item => item.id),
          localeLabels: snapshot.locales.map(item => item.label),
        },
      }

      expect(evaluateRussianLocalizationParity(parityInput)).toEqual([])

      const ruSettingsDict = russianNamespaces.get('settings')
      expect(ruSettingsDict).toBeDefined()
      const expectedCompactSidebarUpdatePills: Readonly<Record<string, string>> = {
        'desktop.update.available': 'Обновление',
        'desktop.update.retry': 'Обновление',
        'desktop.update.checking': 'Проверка…',
        'desktop.update.verifying': 'Проверка…',
        'desktop.update.installing': 'Перезапуск…',
        'desktop.update.ready': 'Перезапустить',
      }
      expect(ruSettingsDict).toMatchObject(expectedCompactSidebarUpdatePills)
      for (const [pillKey, expectedLabel] of Object.entries(expectedCompactSidebarUpdatePills)) {
        const actualLabel = ruSettingsDict?.[pillKey] ?? ''
        expect(actualLabel, `settings:${pillKey}`).toBe(expectedLabel)
        expect(actualLabel.length, `settings:${pillKey} length <= 13`).toBeLessThanOrEqual(13)
      }
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('deterministically rejects missing client keys, missing Desktop keys, placeholder mismatches, and untranslated built-in plugin metadata', () => {
    const baselineInput: RussianParityInput = {
      requiredNamespaces: new Set(['common', 'settings']),
      englishNamespaces: new Map([
        ['common', { copy: 'Copy', countLabel: '{count} items' }],
        ['settings', { title: 'Settings' }],
      ]),
      russianNamespaces: new Map([
        ['common', { copy: 'Копировать', countLabel: '{count, plural, one {# элемент} few {# элемента} many {# элементов} other {# элементов}}' }],
        ['settings', { title: 'Настройки' }],
      ]),
      desktopEnglish: {
        aboutVersion: 'Version V{version}',
        quit: 'Quit',
      },
      desktopRussian: {
        aboutVersion: 'Версия V{version}',
        quit: 'Выйти',
      },
      desktopStartupLocaleId: 'ru',
      pluginMetadata: [
        {
          source: 'packages/core/sample/locale/en.json',
          title: { en: 'Sample plugin', zh: '示例插件' },
          description: { en: 'Provides sample capability.', zh: '提供示例能力。' },
        },
      ],
      metadataCatalog: {
        'Sample plugin': 'Пример плагина',
        'Provides sample capability.': 'Предоставляет тестовую возможность.',
      },
      resolveLocalizedText: (text) => {
        if (typeof text === 'string') return text
        if (text.ru !== undefined) return text.ru
        const catalogHit = ({
          'Sample plugin': 'Пример плагина',
          'Provides sample capability.': 'Предоставляет тестовую возможность.',
        } as Readonly<Record<string, string>>)[text.en]
        return catalogHit ?? text.en
      },
      productBundlePatch: {
        hasLocaleRuInsert: true,
        defaultLocale: 'ru',
        localeOrder: ['ru', 'en', 'zh'],
      },
      bootedLocaleSnapshot: {
        active: 'ru',
        localeIds: ['ru', 'en', 'zh'],
        localeLabels: ['Русский', 'English', '中文'],
      },
    }

    expect(evaluateRussianLocalizationParity(baselineInput)).toEqual([])

    // (i) Simulated client namespace dictionary missing 1 English key & mismatched placeholder
    const missingClientKeyViolations = evaluateRussianLocalizationParity({
      ...baselineInput,
      russianNamespaces: new Map([
        ['common', { countLabel: '{wrongParam} элементов' }],
        ['settings', { title: 'Настройки', strayExtra: 'Лишний ключ' }],
      ]),
    })
    expect(missingClientKeyViolations).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/client namespace "common": missing Russian key\(s\): copy/),
        expect.stringMatching(/client namespace "common" key "countLabel": placeholder mismatch/),
        expect.stringMatching(/client namespace "settings": extra Russian key\(s\) absent from English: strayExtra/),
      ]),
    )

    // (ii) Simulated Desktop `ru` dictionary missing 1 key
    const missingDesktopKeyViolations = evaluateRussianLocalizationParity({
      ...baselineInput,
      desktopRussian: {
        aboutVersion: 'Версия V{version}',
      },
    })
    expect(missingDesktopKeyViolations).toEqual([
      'desktop locale: missing Russian key(s): quit',
    ])

    // (iii) Simulated built-in plugin metadata entry missing from both `text.ru` and `ruPluginMetadataCatalog`
    const missingPluginMetaViolations = evaluateRussianLocalizationParity({
      ...baselineInput,
      pluginMetadata: [
        ...baselineInput.pluginMetadata,
        {
          source: 'packages/core/untranslated/locale/en.json',
          title: { en: 'Untranslated upstream plugin', zh: '未翻译上游插件' },
          description: { en: 'Newly merged upstream plugin description.', zh: '新合并的上游插件描述。' },
        },
      ],
    })
    expect(missingPluginMetaViolations).toEqual([
      'packages/core/untranslated/locale/en.json (title): missing Russian translation for "Untranslated upstream plugin"',
      'packages/core/untranslated/locale/en.json (description): missing Russian translation for "Newly merged upstream plugin description."',
    ])
  })
})
