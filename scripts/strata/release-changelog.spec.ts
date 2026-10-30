/**
 * Integration and behavioral tests for StrataHarness hybrid release changelogs,
 * product release summaries, and `strata:changelog` CLI preview.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { Nodes } from 'mdast'
import { afterEach, describe, expect, it } from 'vitest'
import { parseMarkdown, visitMarkdown } from '../markdown.ts'
import { findViolations as findMarkdownLinkViolations } from '../verify-md-links.ts'
import { collectSkillInvocationMetadataViolations } from '../verify-skill-invocation-metadata.ts'
import {
  collectReleaseArtifacts,
  collectReleaseChangelog,
  generateReleaseNotes,
  readProductReleaseSummary,
  resolveReleaseBaselineTag,
  runReleaseHelperCli,
  runReleasePreflight,
  validateProductReleaseSummary,
} from './release-helper.ts'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const tempDirectories: string[] = []

const GIT_TEST_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Strata Test',
  GIT_AUTHOR_EMAIL: 'strata-test@example.com',
  GIT_COMMITTER_NAME: 'Strata Test',
  GIT_COMMITTER_EMAIL: 'strata-test@example.com',
  GIT_TERMINAL_PROMPT: '0',
}

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirectories.push(dir)
  return dir
}

function writeText(root: string, relativePath: string, content: string): void {
  const fullPath = join(root, relativePath)
  mkdirSync(dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, content, 'utf8')
}

function writeJson(root: string, relativePath: string, value: Record<string, unknown>): void {
  writeText(root, relativePath, `${JSON.stringify(value, null, 2)}\n`)
}

function runGit(cwd: string, args: readonly string[]): string {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: GIT_TEST_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function initReleaseGitFixture(overrides?: {
  readonly productVersion?: string
  readonly engineVersion?: string
  readonly upstreamBaseTag?: string
  readonly methodologyVersion?: string
}): string {
  const repoRoot = createTempDir('strata-changelog-fixture-')
  runGit(repoRoot, ['init', '-b', 'main'])

  const engineVersion = overrides?.engineVersion ?? '0.2.1-rc.4'
  const upstreamBaseTag = overrides?.upstreamBaseTag ?? 'dsh-v0.2.1-rc.4'
  const productVersion = overrides?.productVersion ?? '1.0.0'

  writeJson(repoRoot, 'package.json', {
    name: '@deepseek-ai/dsh-root',
    version: engineVersion,
    private: true,
    type: 'module',
  })
  runGit(repoRoot, ['add', 'package.json'])
  runGit(repoRoot, ['commit', '-m', `chore: upstream ${upstreamBaseTag}`])
  runGit(repoRoot, ['tag', upstreamBaseTag])

  writeJson(repoRoot, 'strata-product.json', {
    productName: 'StrataHarness',
    productVersion,
    upstreamBaseTag,
    upstreamRepository: 'https://github.com/deepseek-ai/deepseek-harness.git',
  })
  writeText(repoRoot, 'resources/strataharness/AGENTS.md', '# StrataHarness Methodology\n')
  writeText(repoRoot, 'resources/strataharness/.agents/skills/tdd/SKILL.md', '# TDD\n')
  writeText(repoRoot, 'resources/strataharness/VERSION', `${overrides?.methodologyVersion ?? '1.4.5'}\n`)

  runGit(repoRoot, ['add', '.'])
  runGit(repoRoot, ['commit', '-m', 'feat(strata): initialize StrataHarness product bundle and methodology'])
  return repoRoot
}

function writeUnsignedThreeTargetArtifacts(artifactsDir: string, buildVersion: string): void {
  writeText(artifactsDir, `strata-dist-win-x64/strataharness-${buildVersion}-win-x64-unsigned.exe`, 'win-exe-bytes')
  writeText(artifactsDir, `strata-dist-mac-arm64/strataharness-${buildVersion}-mac-arm64-unsigned.dmg`, 'mac-arm64-dmg-bytes')
  writeText(artifactsDir, `strata-dist-mac-arm64/strataharness-${buildVersion}-mac-arm64-unsigned.zip`, 'mac-arm64-zip-bytes')
  writeText(artifactsDir, `strata-dist-mac-x64/strataharness-${buildVersion}-mac-x64-unsigned.dmg`, 'mac-x64-dmg-bytes')
  writeText(artifactsDir, `strata-dist-mac-x64/strataharness-${buildVersion}-mac-x64-unsigned.zip`, 'mac-x64-zip-bytes')
}

function findHardWrappedParagraphLines(markdownSource: string): number[] {
  const lines: number[] = []
  visitMarkdown(parseMarkdown(markdownSource), (node: Nodes) => {
    if (node.type === 'paragraph' && node.position !== undefined) {
      if (node.position.end.line > node.position.start.line) {
        lines.push(node.position.start.line)
      }
      return false
    }
  })
  return lines
}

afterEach(() => {
  while (tempDirectories.length > 0) {
    const dir = tempDirectories.pop()
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }
})

describe('StrataHarness product release summaries & soft fallback', { timeout: 30_000 }, () => {
  it('embeds versioned Russian product summary without duplicate H1 before What\'s Changed and validates docs/strata/releases/v*.md', () => {
    const releasesDir = join(REPO_ROOT, 'docs', 'strata', 'releases')
    const releaseFiles = readdirSync(releasesDir).filter(name => /^v.+\.md$/u.test(name))
    expect(releaseFiles).toContain('v1.0.0.md')
    for (const fileName of releaseFiles) {
      const version = fileName.slice(1, -'.md'.length)
      expect(validateProductReleaseSummary(REPO_ROOT, version).found).toBe(true)
    }

    const realV1SummaryPath = join(releasesDir, 'v1.0.0.md')
    const rawV1Source = readFileSync(realV1SummaryPath, 'utf8')
    expect(findMarkdownLinkViolations(realV1SummaryPath)).toEqual([])
    expect(findHardWrappedParagraphLines(rawV1Source)).toEqual([])

    const realSummary = readProductReleaseSummary(REPO_ROOT, '1.0.0')
    expect(realSummary.found).toBe(true)
    expect(realSummary.warning).toBeNull()
    expect(realSummary.markdown).not.toBeNull()
    expect(realSummary.markdown).not.toMatch(/^#\s+/u)
    expect(realSummary.markdown).toContain('@strata/product-bundle')
    expect(realSummary.markdown).toContain('@strata/ui-brand')
    expect(realSummary.markdown).toContain('com.nikl.strataharness')
    expect(realSummary.markdown).toContain('strata-product.json')

    const repoRoot = initReleaseGitFixture({ productVersion: '1.0.0' })
    writeText(repoRoot, 'docs/strata/releases/v1.0.0.md', rawV1Source)
    const artifactsDir = join(repoRoot, 'downloaded')
    writeUnsignedThreeTargetArtifacts(artifactsDir, '1.0.0')

    const warnings: string[] = []
    const collected = collectReleaseArtifacts({
      repoRoot,
      artifactsDir,
      outDir: join(repoRoot, 'bundle'),
      targets: 'all',
      onWarning: msg => warnings.push(msg),
    })

    expect(warnings).toEqual([])
    const notes = collected.releaseNotesMarkdown
    const h1Matches = notes.match(/^#\s+StrataHarness v1\.0\.0$/gmu) ?? []
    expect(h1Matches).toHaveLength(1)

    const metaIndex = notes.indexOf('## Release Metadata')
    const highlightsIndex = notes.indexOf('## Release Highlights')
    const whatsChangedIndex = notes.indexOf("## What's Changed")
    const signingIndex = notes.indexOf('## Platform Signing Status')

    expect(metaIndex).toBeGreaterThan(-1)
    expect(highlightsIndex).toBeGreaterThan(metaIndex)
    expect(whatsChangedIndex).toBeGreaterThan(highlightsIndex)
    expect(signingIndex).toBeGreaterThan(whatsChangedIndex)
    expect(notes).toContain('@strata/product-bundle')

    const directNotes = generateReleaseNotes({
      productName: 'StrataHarness',
      productVersion: '1.0.0',
      buildVersion: '1.0.0',
      engineVersion: '0.2.1-rc.4',
      upstreamBaseTag: 'dsh-v0.2.1-rc.4',
      methodologyRevision: 'v1.4.5',
      isDraft: false,
      isPrerelease: false,
      targets: collected.targets,
      assets: collected.assets,
      productSummaryMarkdown: realSummary.markdown,
      changelogMarkdown: "## What's Changed\n\n- feat(strata): demo (`1234567`)",
    })
    expect(directNotes.indexOf('## Release Highlights')).toBeLessThan(directNotes.indexOf("## What's Changed"))
  })

  it('falls back cleanly when product summary is missing or empty, and rejects invalid Markdown under --strict-summary', () => {
    const repoRoot = initReleaseGitFixture({ productVersion: '1.1.0' })
    const artifactsDir = join(repoRoot, 'downloaded')
    writeUnsignedThreeTargetArtifacts(artifactsDir, '1.1.0')

    const missingWarnings: string[] = []
    const collectedMissing = collectReleaseArtifacts({
      repoRoot,
      artifactsDir,
      outDir: join(repoRoot, 'bundle-missing'),
      targets: 'all',
      onWarning: msg => missingWarnings.push(msg),
    })
    expect(missingWarnings).toHaveLength(1)
    expect(missingWarnings[0]).toContain('docs/strata/releases/v1.1.0.md')
    expect(collectedMissing.releaseNotesMarkdown).not.toContain('## Release Highlights')
    expect(collectedMissing.releaseNotesMarkdown).toContain("## What's Changed")

    const strictMissingCli = runReleaseHelperCli(['changelog', '--version', '1.1.0', '--strict-summary'], { repoRoot })
    expect(strictMissingCli.exitCode).toBe(1)
    expect(strictMissingCli.stderr).toContain('docs/strata/releases/v1.1.0.md')

    const cliCollect = runReleaseHelperCli(
      [
        'collect',
        '--artifacts-dir',
        artifactsDir,
        '--out-dir',
        join(repoRoot, 'bundle-cli-missing'),
        '--targets',
        'win-x64',
        '--draft',
      ],
      { repoRoot },
    )
    expect(cliCollect.exitCode).toBe(0)
    expect(cliCollect.stderr).toContain('docs/strata/releases/v1.1.0.md')

    writeText(repoRoot, 'docs/strata/releases/v1.1.0.md', '   \n\t\n')
    const emptyWarnings: string[] = []
    const emptyResult = readProductReleaseSummary(repoRoot, '1.1.0', {
      onWarning: msg => emptyWarnings.push(msg),
    })
    expect(emptyResult.found).toBe(false)
    expect(emptyResult.markdown).toBeNull()
    expect(emptyWarnings).toHaveLength(1)

    writeText(repoRoot, 'docs/strata/releases/v1.1.0.md', '# StrataHarness v1.1.0\n\n   \n')
    const h1OnlyResult = readProductReleaseSummary(repoRoot, '1.1.0')
    expect(h1OnlyResult.found).toBe(false)
    expect(h1OnlyResult.markdown).toBeNull()
    expect(h1OnlyResult.warning).toContain('docs/strata/releases/v1.1.0.md')

    writeText(
      repoRoot,
      'docs/strata/releases/v1.1.0.md',
      '# StrataHarness v1.1.0\n\nПервая строка абзаца\nвторая физическая строка того же абзаца.\n',
    )
    const hardWrappedCli = runReleaseHelperCli(['changelog', '--version', '1.1.0', '--strict-summary'], { repoRoot })
    expect(hardWrappedCli.exitCode).toBe(1)
    expect(hardWrappedCli.stderr).toContain('hard-wrapped')

    writeText(
      repoRoot,
      'docs/strata/releases/v1.1.0.md',
      '# StrataHarness v1.1.0\n\nСсылка на [несуществующий документ](./missing-doc.md).\n',
    )
    const brokenLinkCli = runReleaseHelperCli(['changelog', '--version', '1.1.0', '--strict-summary'], { repoRoot })
    expect(brokenLinkCli.exitCode).toBe(1)
    expect(brokenLinkCli.stderr).toContain('missing-doc.md')
  })
})

describe('StrataHarness release baseline tag resolver', { timeout: 30_000 }, () => {
  it('selects upstreamBaseTag for first release, highest prior stable strata-v* for stable builds, and highest prior any strata-v* for prereleases', () => {
    const repoRoot = initReleaseGitFixture({ productVersion: '1.0.0', upstreamBaseTag: 'dsh-v0.2.1-rc.4' })

    expect(resolveReleaseBaselineTag({ repoRoot, buildVersion: '1.0.0' })).toBe('dsh-v0.2.1-rc.4')
    expect(resolveReleaseBaselineTag({ repoRoot, buildVersion: '1.0.0-rc.1' })).toBe('dsh-v0.2.1-rc.4')

    runGit(repoRoot, ['tag', 'strata-v1.0.0'])
    expect(resolveReleaseBaselineTag({ repoRoot, buildVersion: '1.0.0' })).toBe('dsh-v0.2.1-rc.4')

    writeText(repoRoot, 'notes.txt', '1.0.1\n')
    runGit(repoRoot, ['add', 'notes.txt'])
    runGit(repoRoot, ['commit', '-m', 'fix(strata): patch 1.0.1'])
    runGit(repoRoot, ['tag', 'strata-v1.0.1'])
    runGit(repoRoot, ['tag', 'strata-vnot-a-semver'])
    runGit(repoRoot, ['tag', 'strata-v01.9.0'])

    writeText(repoRoot, 'notes.txt', '1.1.0-rc.1\n')
    runGit(repoRoot, ['add', 'notes.txt'])
    runGit(repoRoot, ['commit', '-m', 'feat(strata): rc 1'])
    runGit(repoRoot, ['tag', 'strata-v1.1.0-rc.1'])

    writeText(repoRoot, 'notes.txt', '1.1.0-rc.2\n')
    runGit(repoRoot, ['add', 'notes.txt'])
    runGit(repoRoot, ['commit', '-m', 'fix(strata): rc 2'])
    runGit(repoRoot, ['tag', 'strata-v1.1.0-rc.2'])

    expect(resolveReleaseBaselineTag({ repoRoot, buildVersion: '1.1.0-rc.1' })).toBe('strata-v1.0.1')
    expect(resolveReleaseBaselineTag({ repoRoot, buildVersion: '1.1.0-rc.2' })).toBe('strata-v1.1.0-rc.1')
    expect(resolveReleaseBaselineTag({ repoRoot, buildVersion: '1.1.0-rc.3' })).toBe('strata-v1.1.0-rc.2')

    expect(resolveReleaseBaselineTag({ repoRoot, buildVersion: '1.1.0' })).toBe('strata-v1.0.1')
    runGit(repoRoot, ['tag', 'strata-v1.1.0'])
    expect(resolveReleaseBaselineTag({ repoRoot, buildVersion: '1.1.0' })).toBe('strata-v1.0.1')

    expect(
      resolveReleaseBaselineTag({
        repoRoot,
        buildVersion: '0.9.0',
        upstreamBaseTag: 'dsh-v9.9.9-missing',
      }),
    ).toBeNull()

    expect(() => resolveReleaseBaselineTag({ repoRoot, buildVersion: '   ' })).toThrow(/SemVer/u)
    expect(() =>
      resolveReleaseBaselineTag({ repoRoot, buildVersion: '1.0.0', upstreamBaseTag: 'dsh-vnot-semver' }),
    ).toThrow(/SemVer/u)

    const nonGitDir = createTempDir('strata-non-git-')
    writeJson(nonGitDir, 'strata-product.json', {
      productName: 'StrataHarness',
      productVersion: '1.0.0',
      upstreamBaseTag: 'dsh-v0.2.1-rc.4',
      upstreamRepository: 'https://github.com/deepseek-ai/deepseek-harness.git',
    })
    expect(resolveReleaseBaselineTag({ repoRoot: nonGitDir, buildVersion: '1.0.0' })).toBeNull()

    writeJson(nonGitDir, 'strata-product.json', {
      productName: '   ',
      productVersion: '1.0.0',
      upstreamBaseTag: 'dsh-v0.2.1-rc.4',
    })
    expect(() => resolveReleaseBaselineTag({ repoRoot: nonGitDir })).toThrow(/productName/u)
  })
})

function appendFastCommits(cwd: string, messages: readonly string[]): void {
  const chunks: string[] = []
  const timestamp = 1_730_000_000
  for (const [index, message] of messages.entries()) {
    const byteLength = Buffer.byteLength(message, 'utf8')
    chunks.push('commit refs/heads/main\n')
    chunks.push(`committer Strata Test <strata-test@example.com> ${String(timestamp + index)} +0000\n`)
    chunks.push(`data ${String(byteLength)}\n${message}\n`)
    if (index === 0) {
      chunks.push('from refs/heads/main^0\n')
    }
    chunks.push('\n')
  }
  execFileSync('git', ['fast-import', '--quiet'], {
    cwd,
    input: chunks.join(''),
    encoding: 'utf8',
    env: GIT_TEST_ENV,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  runGit(cwd, ['reset', '--hard', 'refs/heads/main'])
}

describe('StrataHarness release changelog collector — platform deltas, filtering, categories, and truncation', { timeout: 30_000 }, () => {
  it('excludes transitive upstream commits on engine upgrades, summarizes upstream commit count, and reports methodology submodule gitlink deltas', () => {
    const repoRoot = createTempDir('strata-changelog-sync-')
    runGit(repoRoot, ['init', '-b', 'main'])

    writeJson(repoRoot, 'package.json', {
      name: '@deepseek-ai/dsh-root',
      version: '0.2.1-rc.4',
      private: true,
      type: 'module',
    })
    runGit(repoRoot, ['add', 'package.json'])
    runGit(repoRoot, ['commit', '-m', 'chore: upstream dsh-v0.2.1-rc.4'])
    runGit(repoRoot, ['tag', 'dsh-v0.2.1-rc.4'])

    const subHashV1 = '1111111111111111111111111111111111111111'
    const subHashV2 = '2222222222222222222222222222222222222222'
    writeJson(repoRoot, 'strata-product.json', {
      productName: 'StrataHarness',
      productVersion: '1.0.0',
      upstreamBaseTag: 'dsh-v0.2.1-rc.4',
      upstreamRepository: 'https://github.com/deepseek-ai/deepseek-harness.git',
    })
    runGit(repoRoot, ['add', 'strata-product.json'])
    runGit(repoRoot, ['update-index', '--add', '--cacheinfo', `160000,${subHashV1},resources/strataharness`])
    runGit(repoRoot, ['commit', '-m', 'feat(strata): bootstrap StrataHarness v1.0.0'])

    const firstRelease = collectReleaseChangelog({ repoRoot, buildVersion: '1.0.0' })
    expect(firstRelease.baselineTag).toBe('dsh-v0.2.1-rc.4')
    expect(firstRelease.baselineEngineVersion).toBe('0.2.1-rc.4')
    expect(firstRelease.targetEngineVersion).toBe('0.2.1-rc.4')
    expect(firstRelease.upstreamCommitCount).toBe(0)
    expect(firstRelease.platformUpdates).toContain(
      'Methodology submodule (`resources/strataharness`): bundled at `1111111`',
    )
    expect(firstRelease.totalCommits).toBe(1)

    runGit(repoRoot, ['tag', 'strata-v1.0.0'])

    runGit(repoRoot, ['checkout', '-b', 'upstream-line', 'dsh-v0.2.1-rc.4'])
    writeText(repoRoot, 'upstream-a.ts', 'export const A = 1\n')
    runGit(repoRoot, ['add', 'upstream-a.ts'])
    runGit(repoRoot, ['commit', '-m', 'feat: upstream kernel A'])

    writeText(repoRoot, 'upstream-b.ts', 'export const B = 2\n')
    runGit(repoRoot, ['add', 'upstream-b.ts'])
    runGit(repoRoot, ['commit', '-m', 'fix: upstream parser B'])

    writeText(repoRoot, 'upstream-c.ts', 'export const C = 3\n')
    runGit(repoRoot, ['add', 'upstream-c.ts'])
    runGit(repoRoot, ['commit', '-m', 'perf: upstream loop C'])

    writeJson(repoRoot, 'package.json', {
      name: '@deepseek-ai/dsh-root',
      version: '0.3.0',
      private: true,
      type: 'module',
    })
    runGit(repoRoot, ['add', 'package.json'])
    runGit(repoRoot, ['commit', '-m', 'chore: release dsh 0.3.0'])
    runGit(repoRoot, ['tag', 'dsh-v0.3.0'])

    runGit(repoRoot, ['checkout', 'main'])
    runGit(repoRoot, ['merge', '--no-ff', 'dsh-v0.3.0', '-m', "chore: merge tag 'dsh-v0.3.0'"])

    runGit(repoRoot, ['update-index', '--cacheinfo', `160000,${subHashV2},resources/strataharness`])
    writeText(repoRoot, 'override.ts', 'export const OVERRIDE = true\n')
    runGit(repoRoot, ['add', 'override.ts'])
    runGit(repoRoot, ['commit', '-m', 'strata(override): adapt desktop profile for dsh-v0.3.0'])

    writeText(repoRoot, 'feature.ts', 'export const FEATURE = true\n')
    runGit(repoRoot, ['add', 'feature.ts'])
    runGit(repoRoot, ['commit', '-m', 'feat(strata): add multi-provider preset diagnostics'])

    writeJson(repoRoot, 'strata-product.json', {
      productName: 'StrataHarness',
      productVersion: '1.1.0',
      upstreamBaseTag: 'dsh-v0.3.0',
      upstreamRepository: 'https://github.com/deepseek-ai/deepseek-harness.git',
    })
    runGit(repoRoot, ['add', 'strata-product.json'])
    runGit(repoRoot, ['commit', '-m', 'chore(strata): bump product version to 1.1.0'])

    const syncedChangelog = collectReleaseChangelog({ repoRoot, buildVersion: '1.1.0' })
    expect(syncedChangelog.baselineTag).toBe('strata-v1.0.0')
    expect(syncedChangelog.baselineUpstreamTag).toBe('dsh-v0.2.1-rc.4')
    expect(syncedChangelog.upstreamBaseTag).toBe('dsh-v0.3.0')
    expect(syncedChangelog.baselineEngineVersion).toBe('0.2.1-rc.4')
    expect(syncedChangelog.targetEngineVersion).toBe('0.3.0')
    expect(syncedChangelog.upstreamCommitCount).toBe(4)
    expect(syncedChangelog.methodologyDelta).toEqual({
      previousHash: subHashV1,
      currentHash: subHashV2,
    })
    expect(syncedChangelog.platformUpdates).toEqual([
      'Engine upgraded: `dsh-v0.2.1-rc.4` -> `dsh-v0.3.0` (4 upstream commit(s))',
      'Methodology submodule (`resources/strataharness`): `1111111` -> `2222222`',
    ])

    expect(syncedChangelog.totalCommits).toBe(2)
    expect(syncedChangelog.markdown).toContain(
      '- Engine upgraded: `dsh-v0.2.1-rc.4` -> `dsh-v0.3.0` (4 upstream commit(s))',
    )
    expect(syncedChangelog.markdown).toContain(
      '- Methodology submodule (`resources/strataharness`): `1111111` -> `2222222`',
    )
    expect(syncedChangelog.markdown).not.toContain('upstream kernel A')
    expect(syncedChangelog.markdown).not.toContain('upstream parser B')
    expect(syncedChangelog.markdown).not.toContain('upstream loop C')
    expect(syncedChangelog.markdown).not.toContain('release dsh 0.3.0')
    expect(syncedChangelog.markdown).not.toContain('bump product version')
    expect(syncedChangelog.categories.Features.map(c => c.subject)).toEqual([
      'feat(strata): add multi-provider preset diagnostics',
    ])
    expect(syncedChangelog.categories['Engine & Desktop Overrides'].map(c => c.subject)).toEqual([
      'strata(override): adapt desktop profile for dsh-v0.3.0',
    ])

    writeText(repoRoot, 'resources/strataharness/AGENTS.md', '# StrataHarness Methodology\n')
    writeText(repoRoot, 'resources/strataharness/.agents/skills/tdd/SKILL.md', '# TDD\n')
    writeText(repoRoot, 'resources/strataharness/VERSION', '1.4.5\n')
    runGit(repoRoot, ['tag', '-d', 'dsh-v0.3.0'])
    const missingBaseWarnings: string[] = []
    collectReleaseChangelog({
      repoRoot,
      buildVersion: '1.1.0',
      onWarning: msg => missingBaseWarnings.push(msg),
    })
    expect(missingBaseWarnings).toHaveLength(1)
    expect(missingBaseWarnings[0]).toContain('dsh-v0.3.0')
    expect(() =>
      runReleasePreflight({
        repoRoot,
        eventName: 'push',
        gitRef: 'refs/tags/strata-v1.1.0',
      }),
    ).toThrow(/dsh-v0\.3\.0/u)
  })

  it('filters housekeeping release bumps, distinguishes strata(override) from other strata scopes, orders 5 commit categories, truncates >50 commits, and reports empty ranges explicitly', () => {
    const repoRoot = initReleaseGitFixture({ productVersion: '1.0.0' })
    runGit(repoRoot, ['tag', 'strata-v1.0.0'])

    const emptyAtTag = collectReleaseChangelog({ repoRoot, buildVersion: '1.0.1' })
    expect(emptyAtTag.baselineTag).toBe('strata-v1.0.0')
    expect(emptyAtTag.hasChanges).toBe(false)
    expect(emptyAtTag.totalCommits).toBe(0)
    expect(emptyAtTag.markdown).toContain('No functional commits recorded since `strata-v1.0.0`.')

    appendFastCommits(repoRoot, [
      'chore(strata): bump product version to 1.0.1',
      'chore(strata): prepare release v1.0.1',
      'chore(strata): release strata-v1.0.1',
    ])
    const bumpOnly = collectReleaseChangelog({ repoRoot, buildVersion: '1.0.1' })
    expect(bumpOnly.hasChanges).toBe(false)
    expect(bumpOnly.totalCommits).toBe(0)
    expect(bumpOnly.markdown).toContain('No functional commits recorded since `strata-v1.0.0`.')

    appendFastCommits(repoRoot, [
      'docs(strata): update fork maintenance guide',
      'chore(deps): refresh workspace lockfile',
      'strata(bundle): sync bundled methodology pointer',
      'ci(release): cache windows electron binary',
      'build(desktop): tighten packaging check',
      'refactor(strata): extract semver validator',
      'test(strata): cover release preflight edge cases',
      'strata(override): isolate user home directory',
      'fix(desktop): prevent tray icon leak',
      'perf(boot): defer lazy bundle resolution',
      'feat(strata): add interactive release changelog preview',
    ])

    const categorized = collectReleaseChangelog({ repoRoot, buildVersion: '1.0.1' })
    expect(categorized.hasChanges).toBe(true)
    expect(categorized.totalCommits).toBe(11)
    expect(categorized.truncatedCommits).toBe(0)
    expect(categorized.categories.Features).toHaveLength(1)
    expect(categorized.categories.Fixes).toHaveLength(2)
    expect(categorized.categories['Engine & Desktop Overrides'].map(c => c.subject)).toEqual([
      'strata(override): isolate user home directory',
    ])
    expect(categorized.categories['CI & Tooling']).toHaveLength(4)
    expect(categorized.categories['Documentation & Other']).toHaveLength(3)

    const md = categorized.markdown
    const idxFeatures = md.indexOf('### Features')
    const idxFixes = md.indexOf('### Fixes')
    const idxOverrides = md.indexOf('### Engine & Desktop Overrides')
    const idxTooling = md.indexOf('### CI & Tooling')
    const idxDocs = md.indexOf('### Documentation & Other')
    expect(idxFeatures).toBeGreaterThan(-1)
    expect(idxFixes).toBeGreaterThan(idxFeatures)
    expect(idxOverrides).toBeGreaterThan(idxFixes)
    expect(idxTooling).toBeGreaterThan(idxOverrides)
    expect(idxDocs).toBeGreaterThan(idxTooling)
    expect(md).toMatch(/- feat\(strata\): add interactive release changelog preview \(`[0-9a-f]{7,}`\)/u)

    const extraMessages = Array.from({ length: 44 }, (_, i) => `feat(batch): capability item #${String(i + 1)}`)
    appendFastCommits(repoRoot, extraMessages)

    const truncated = collectReleaseChangelog({ repoRoot, buildVersion: '1.0.1' })
    expect(truncated.totalCommits).toBe(55)
    expect(truncated.renderedCommits).toBe(50)
    expect(truncated.truncatedCommits).toBe(5)
    expect(truncated.markdown).toContain('- …and 5 more commit(s)')
    const commitBullets = truncated.markdown
      .split('\n')
      .filter(line => /^- .+ \(`[0-9a-f]{7,}`\)$/u.test(line))
    expect(commitBullets).toHaveLength(50)
  })
})

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

describe('StrataHarness release-helper CLI changelog subcommand & npm script', { timeout: 30_000 }, () => {
  it('exposes strata:changelog in root package.json and outputs Markdown and JSON previews with exitCode 0', () => {
    const rootPkgRaw: unknown = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'))
    if (!isJsonRecord(rootPkgRaw) || !isJsonRecord(rootPkgRaw.scripts)) {
      throw new Error('Expected root package.json scripts object')
    }
    expect(rootPkgRaw.scripts['strata:changelog']).toBe('tsx scripts/strata/release-helper.ts changelog')

    const repoRoot = initReleaseGitFixture({ productVersion: '1.0.0' })
    writeText(
      repoRoot,
      'docs/strata/releases/v1.0.0.md',
      '# StrataHarness v1.0.0\n\nКраткое продуктовое резюме первого релиза на русском языке.\n',
    )
    runGit(repoRoot, ['add', 'docs/strata/releases/v1.0.0.md'])
    runGit(repoRoot, ['commit', '-m', 'docs(strata): add v1.0.0 release summary'])

    const mdCli = runReleaseHelperCli(['changelog', '--strict-summary'], { repoRoot })
    expect(mdCli.exitCode).toBe(0)
    expect(mdCli.stderr).toBe('')
    expect(mdCli.stdout).toContain('StrataHarness v1.0.0')
    expect(mdCli.stdout).toContain('docs/strata/releases/v1.0.0.md')
    expect(mdCli.stdout).toContain('## Release Highlights')
    expect(mdCli.stdout).toContain('Краткое продуктовое резюме первого релиза на русском языке.')
    expect(mdCli.stdout).toContain("## What's Changed")
    expect(mdCli.stdout).toContain('feat(strata): initialize StrataHarness product bundle and methodology')

    runGit(repoRoot, ['tag', 'strata-v1.0.0'])
    writeText(repoRoot, 'fix.ts', 'export const FIXED = 1\n')
    runGit(repoRoot, ['add', 'fix.ts'])
    runGit(repoRoot, ['commit', '-m', 'fix(strata): handle missing workspace config'])

    const jsonCli = runReleaseHelperCli(
      ['changelog', '--version', '1.0.1', '--base', 'strata-v1.0.0', '--target-ref', 'HEAD', '--json'],
      { repoRoot },
    )
    expect(jsonCli.exitCode).toBe(0)
    expect(jsonCli.stderr).toContain('docs/strata/releases/v1.0.1.md')
    const payload: unknown = JSON.parse(jsonCli.stdout)
    expect(payload).toMatchObject({
      buildVersion: '1.0.1',
      releaseTag: 'strata-v1.0.1',
      baselineTag: 'strata-v1.0.0',
      baselineEngineVersion: '0.2.1-rc.4',
      targetEngineVersion: '0.2.1-rc.4',
      targetRef: 'HEAD',
      totalCommits: 1,
      hasChanges: true,
      summary: {
        relativePath: 'docs/strata/releases/v1.0.1.md',
        found: false,
        markdown: null,
      },
    })

    const badVersionCli = runReleaseHelperCli(['changelog', '--version', 'v1.0'], { repoRoot })
    expect(badVersionCli.exitCode).toBe(1)
    expect(badVersionCli.stderr).toContain('SemVer')

    const emptyVersionCli = runReleaseHelperCli(['changelog', '--version', '   '], { repoRoot })
    expect(emptyVersionCli.exitCode).toBe(1)
    expect(emptyVersionCli.stderr).toContain('version')

    const emptyBaseCli = runReleaseHelperCli(['changelog', '--base', '   '], { repoRoot })
    expect(emptyBaseCli.exitCode).toBe(1)
    expect(emptyBaseCli.stderr).toContain('baselineTag')

    const emptyTargetRefCli = runReleaseHelperCli(['changelog', '--target-ref', ''], { repoRoot })
    expect(emptyTargetRefCli.exitCode).toBe(1)
    expect(emptyTargetRefCli.stderr).toContain('targetRef')

    const badBaseCli = runReleaseHelperCli(['changelog', '--base', 'strata-v9.9.9'], { repoRoot })
    expect(badBaseCli.exitCode).toBe(1)
    expect(badBaseCli.stderr).toContain('strata-v9.9.9')
  })
})

describe('StrataHarness manual /strata-release skill & fork maintenance runbook', () => {
  it('registers manual-only strata-release skill, mirrors to .claude/skills, and documents hybrid release workflow in fork-maintenance.md', () => {
    const skillPath = join(REPO_ROOT, '.agents', 'skills', 'strata-release', 'SKILL.md')
    const openaiYamlPath = join(REPO_ROOT, '.agents', 'skills', 'strata-release', 'agents', 'openai.yaml')
    const claudeMirrorSkillPath = join(REPO_ROOT, '.claude', 'skills', 'strata-release', 'SKILL.md')
    const claudeMirrorOpenaiPath = join(REPO_ROOT, '.claude', 'skills', 'strata-release', 'agents', 'openai.yaml')
    const registryPath = join(REPO_ROOT, '.agents', 'SKILLS.md')
    const runbookPath = join(REPO_ROOT, 'docs', 'strata', 'fork-maintenance.md')

    const skillText = readFileSync(skillPath, 'utf8')
    const openaiText = readFileSync(openaiYamlPath, 'utf8')
    expect(skillText).toContain('name: strata-release')
    expect(skillText).toContain('disable-model-invocation: true')
    expect(skillText).toContain('1.0.0')
    expect(skillText).toContain('git fetch origin --tags')
    expect(skillText).toContain('strata:changelog')
    expect(skillText).toContain('--strict-summary')
    expect(skillText).toContain('strata:version')
    expect(skillText).toContain('chore(strata): prepare release v')
    expect(skillText).toContain('git push --atomic origin')
    expect(skillText).toContain('refs/tags/<upstreamBaseTag>:refs/tags/<upstreamBaseTag>')
    expect(openaiText).toContain('allow_implicit_invocation: false')

    expect(readFileSync(claudeMirrorSkillPath, 'utf8')).toBe(skillText)
    expect(readFileSync(claudeMirrorOpenaiPath, 'utf8')).toBe(openaiText)

    const registryText = readFileSync(registryPath, 'utf8')
    expect(registryText).toMatch(
      /^\|\s*\[strata-release\]\(skills\/strata-release\/SKILL\.md\)\s*\|.*\|\s*ручной\s*\|\s*свой\s*\|\s*active\s*\|$/mu,
    )
    expect(collectSkillInvocationMetadataViolations(REPO_ROOT)).toEqual([])
    expect(findMarkdownLinkViolations(skillPath)).toEqual([])

    const runbookText = readFileSync(runbookPath, 'utf8')
    expect(runbookText).toContain('docs/strata/releases/')
    expect(runbookText).toContain('pnpm run strata:changelog')
    expect(runbookText).toContain('--strict-summary')
    expect(runbookText).toContain('git push --atomic origin')
    expect(runbookText).toContain('/strata-release')
    expect(findMarkdownLinkViolations(runbookPath)).toEqual([])
    expect(findHardWrappedParagraphLines(runbookText)).toEqual([])
  })
})
