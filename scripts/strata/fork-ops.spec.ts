/** Behavioral tests for the Soft-Fork operations CLI and upstream release radar workflow. */

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import {
  auditForkOverrides,
  bumpStrataVersion,
  checkUpstreamReleases,
  getForkStatus,
  prepareUpstreamSync,
  runForkOpsCli,
  updateMethodologySubmodule,
} from './fork-ops.ts'

const tempDirectories: string[] = []

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

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readJsonRecord(root: string, relativePath: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(join(root, relativePath), 'utf8'))
  if (!isJsonRecord(parsed)) {
    throw new Error(`Expected JSON object in ${relativePath}`)
  }
  return parsed
}

const GIT_TEST_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Strata Test',
  GIT_AUTHOR_EMAIL: 'strata-test@example.com',
  GIT_COMMITTER_NAME: 'Strata Test',
  GIT_COMMITTER_EMAIL: 'strata-test@example.com',
  GIT_TERMINAL_PROMPT: '0',
}

function runGit(cwd: string, args: readonly string[]): string {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: GIT_TEST_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function populateCompliantFilesystem(repoRoot: string): void {
  writeJson(repoRoot, 'package.json', {
    name: '@deepseek-ai/dsh-root',
    version: '0.2.1-rc.4',
    private: true,
    type: 'module',
  })
  writeJson(repoRoot, 'packages/core/agent/package.json', {
    name: '@deepseek-ai/dsh-agent',
    version: '0.2.1-rc.4',
  })
  writeJson(repoRoot, 'strata-product.json', {
    productName: 'StrataHarness',
    productVersion: '1.0.0',
    upstreamBaseTag: 'dsh-v0.2.1-rc.4',
    upstreamRepository: 'https://github.com/deepseek-ai/deepseek-harness.git',
  })
  writeJson(repoRoot, 'packages/strata/product-bundle/package.json', {
    name: '@strata/product-bundle',
    version: '1.0.0',
  })
  writeJson(repoRoot, 'packages/strata/ui-brand/package.json', {
    name: '@strata/ui-brand',
    version: '1.0.0',
  })
  writeText(
    repoRoot,
    'apps/desktop/scripts/strata-desktop-config.mjs',
    [
      "export const STRATA_DESKTOP_PACKAGE_NAME = '@strata/desktop'",
      "export const STRATA_DESKTOP_APP_ID = 'com.nikl.strataharness'",
      "export const STRATA_DESKTOP_URL_SCHEME = 'strata'",
      'export const STRATA_PRODUCTION_UPDATE_FIXED_ORIGIN = undefined',
      "const BLOCKED_UPSTREAM_UPDATE_ORIGINS = new Set(['https://download.deepseek.com'])",
      'export { BLOCKED_UPSTREAM_UPDATE_ORIGINS }',
      '',
    ].join('\n'),
  )
  writeText(
    repoRoot,
    'packages/boot/app-boot/src/profile.ts',
    "export const PROFILE_TEMPLATES = { web: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@strata/product-bundle'] } }\n",
  )
  writeText(
    repoRoot,
    'apps/desktop/src/project-manager.ts',
    "const STRATA_PRODUCT_BUNDLE = '@strata/product-bundle'\nexport { STRATA_PRODUCT_BUNDLE }\n",
  )
  writeText(
    repoRoot,
    'apps/desktop/src/paths.ts',
    "export const STRATA_HOME_DIR_NAME = '.strataharness'\n",
  )
  writeText(repoRoot, 'resources/strataharness/AGENTS.md', '# StrataHarness Methodology\n')
  writeText(repoRoot, 'resources/strataharness/.agents/skills/tdd/SKILL.md', '# TDD\n')
  writeText(repoRoot, '.github/workflows/strata-upstream-watch.yml', 'name: Strata Upstream Watch\n')
  writeText(repoRoot, '.github/upstream-workflows/dependabot.yml', 'version: 2\nupdates: []\n')
}

function createCompliantFilesystemFixture(): string {
  const repoRoot = createTempDir('strata-fork-fs-')
  populateCompliantFilesystem(repoRoot)
  return repoRoot
}

function initGitRepo(cwd: string): void {
  runGit(cwd, ['init', '-b', 'main'])
}

function createCompliantForkFixture(): string {
  const repoRoot = createTempDir('strata-fork-ops-')
  initGitRepo(repoRoot)

  writeJson(repoRoot, 'package.json', {
    name: '@deepseek-ai/dsh-root',
    version: '0.2.1-rc.4',
    private: true,
    type: 'module',
  })
  writeJson(repoRoot, 'packages/core/agent/package.json', {
    name: '@deepseek-ai/dsh-agent',
    version: '0.2.1-rc.4',
  })
  writeText(
    repoRoot,
    'packages/boot/app-boot/src/profile.ts',
    "export const PROFILE_TEMPLATES = { web: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } }\n",
  )
  writeText(
    repoRoot,
    'apps/desktop/src/paths.ts',
    "export const STRATA_HOME_DIR_NAME = '.dsh'\n",
  )
  writeText(
    repoRoot,
    'apps/desktop/src/project-manager.ts',
    "export const WEB_APP_BUNDLE = '@deepseek-ai/dsh-web-app'\n",
  )

  runGit(repoRoot, ['add', '.'])
  runGit(repoRoot, ['commit', '-m', 'chore: upstream baseline'])
  runGit(repoRoot, ['tag', 'dsh-v0.2.1-rc.4'])

  // Layer Soft-Fork files and marked strata(override) commits above upstreamBaseTag.
  writeJson(repoRoot, 'strata-product.json', {
    productName: 'StrataHarness',
    productVersion: '1.0.0',
    upstreamBaseTag: 'dsh-v0.2.1-rc.4',
    upstreamRepository: 'https://github.com/deepseek-ai/deepseek-harness.git',
  })
  writeJson(repoRoot, 'packages/strata/product-bundle/package.json', {
    name: '@strata/product-bundle',
    version: '1.0.0',
  })
  writeJson(repoRoot, 'packages/strata/ui-brand/package.json', {
    name: '@strata/ui-brand',
    version: '1.0.0',
  })
  writeText(
    repoRoot,
    'apps/desktop/scripts/strata-desktop-config.mjs',
    [
      "export const STRATA_DESKTOP_PACKAGE_NAME = '@strata/desktop'",
      "export const STRATA_DESKTOP_APP_ID = 'com.nikl.strataharness'",
      "export const STRATA_DESKTOP_URL_SCHEME = 'strata'",
      'export const STRATA_PRODUCTION_UPDATE_FIXED_ORIGIN = undefined',
      "const BLOCKED_UPSTREAM_UPDATE_ORIGINS = new Set(['https://download.deepseek.com'])",
      'export { BLOCKED_UPSTREAM_UPDATE_ORIGINS }',
      '',
    ].join('\n'),
  )
  writeText(repoRoot, 'resources/strataharness/AGENTS.md', '# StrataHarness Methodology\n')
  writeText(repoRoot, 'resources/strataharness/.agents/skills/tdd/SKILL.md', '# TDD\n')
  writeText(repoRoot, '.github/workflows/strata-upstream-watch.yml', 'name: Strata Upstream Watch\n')

  runGit(repoRoot, ['add', '.'])
  runGit(repoRoot, ['commit', '-m', 'feat(strata): initialize product packages and methodology'])

  writeText(
    repoRoot,
    'packages/boot/app-boot/src/profile.ts',
    "export const PROFILE_TEMPLATES = { web: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@strata/product-bundle'] } }\n",
  )
  writeText(
    repoRoot,
    'apps/desktop/src/project-manager.ts',
    "const STRATA_PRODUCT_BUNDLE = '@strata/product-bundle'\nexport { STRATA_PRODUCT_BUNDLE }\n",
  )
  runGit(repoRoot, ['add', 'packages/boot/app-boot/src/profile.ts', 'apps/desktop/src/project-manager.ts'])
  runGit(repoRoot, ['commit', '-m', 'strata(override): wire @strata/product-bundle into web and desktop profiles'])

  writeText(
    repoRoot,
    'apps/desktop/src/paths.ts',
    "export const STRATA_HOME_DIR_NAME = '.strataharness'\n",
  )
  runGit(repoRoot, ['add', 'apps/desktop/src/paths.ts'])
  runGit(repoRoot, ['commit', '-m', 'strata(override): isolate StrataHarness user home to ~/.strataharness'])

  return repoRoot
}

afterEach(() => {
  while (tempDirectories.length > 0) {
    const dir = tempDirectories.pop()
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

describe('Soft-Fork Operations CLI — status & version', { timeout: 30_000 }, () => {
  it('reports dual-track product and engine versions, @strata/* packages, override count, and working-tree state', () => {
    const repoRoot = createCompliantForkFixture()

    const status = getForkStatus(repoRoot)
    expect(status.productName).toBe('StrataHarness')
    expect(status.productVersion).toBe('1.0.0')
    expect(status.engineVersion).toBe('0.2.1-rc.4')
    expect(status.upstreamBaseTag).toBe('dsh-v0.2.1-rc.4')
    expect(status.overrideCommitCount).toBe(2)
    expect(status.workingTreeClean).toBe(true)
    expect(status.strataPackages).toEqual([
      { name: '@strata/product-bundle', directory: 'packages/strata/product-bundle', version: '1.0.0' },
      { name: '@strata/ui-brand', directory: 'packages/strata/ui-brand', version: '1.0.0' },
    ])

    const humanCli = runForkOpsCli(['status'], { repoRoot })
    expect(humanCli.exitCode).toBe(0)
    expect(humanCli.stdout).toContain('Product: StrataHarness 1.0.0')
    expect(humanCli.stdout).toContain('Engine: DSH 0.2.1-rc.4 (base tag: dsh-v0.2.1-rc.4)')

    writeText(repoRoot, 'untracked-note.txt', 'dirty\n')
    const jsonCli = runForkOpsCli(['status', '--json'], { repoRoot })
    expect(jsonCli.exitCode).toBe(0)
    const parsedJson: unknown = JSON.parse(jsonCli.stdout)
    expect(parsedJson).toMatchObject({
      productVersion: '1.0.0',
      engineVersion: '0.2.1-rc.4',
      workingTreeClean: false,
      dirtyEntriesCount: 1,
    })
  })

  it('atomically bumps minor, patch, and explicit SemVer + upstreamBaseTag across strata-product.json and @strata/* only', () => {
    const repoRoot = createCompliantFilesystemFixture()

    const minorCli = runForkOpsCli(['version', 'minor'], { repoRoot })
    expect(minorCli.exitCode).toBe(0)
    expect(readJsonRecord(repoRoot, 'strata-product.json').productVersion).toBe('1.1.0')
    expect(readJsonRecord(repoRoot, 'packages/strata/product-bundle/package.json').version).toBe('1.1.0')
    expect(readJsonRecord(repoRoot, 'packages/strata/ui-brand/package.json').version).toBe('1.1.0')

    const patchResult = bumpStrataVersion({ repoRoot, target: 'patch' })
    expect(patchResult.previousVersion).toBe('1.1.0')
    expect(patchResult.productVersion).toBe('1.1.1')
    expect(readJsonRecord(repoRoot, 'strata-product.json').productVersion).toBe('1.1.1')
    expect(readJsonRecord(repoRoot, 'packages/strata/product-bundle/package.json').version).toBe('1.1.1')

    const explicitCli = runForkOpsCli(['version', '2.0.0', '--upstream-base', 'dsh-v0.3.0'], { repoRoot })
    expect(explicitCli.exitCode).toBe(0)
    expect(readJsonRecord(repoRoot, 'strata-product.json')).toMatchObject({
      productVersion: '2.0.0',
      upstreamBaseTag: 'dsh-v0.3.0',
    })
    expect(readJsonRecord(repoRoot, 'packages/strata/product-bundle/package.json').version).toBe('2.0.0')
    expect(readJsonRecord(repoRoot, 'packages/strata/ui-brand/package.json').version).toBe('2.0.0')

    // Root and @deepseek-ai/dsh-* manifests remain untouched at the engine version.
    expect(readJsonRecord(repoRoot, 'package.json').version).toBe('0.2.1-rc.4')
    expect(readJsonRecord(repoRoot, 'packages/core/agent/package.json').version).toBe('0.2.1-rc.4')
  })

  it('rejects invalid SemVer versions and malformed upstreamBaseTag values without mutating manifests', () => {
    const repoRoot = createCompliantFilesystemFixture()

    expect(() => bumpStrataVersion({ repoRoot, target: 'v1.2.3' })).toThrow(/SemVer/i)
    expect(() => bumpStrataVersion({ repoRoot, target: '1.2.3+build.9' })).toThrow(/build metadata/i)
    expect(() => bumpStrataVersion({ repoRoot, target: 'minor', upstreamBaseTag: 'v0.3.0' })).toThrow(/dsh-v/i)

    const failedCli = runForkOpsCli(['version', 'not-a-semver'], { repoRoot })
    expect(failedCli.exitCode).toBe(1)
    expect(readJsonRecord(repoRoot, 'strata-product.json').productVersion).toBe('1.0.0')
    expect(readJsonRecord(repoRoot, 'packages/strata/product-bundle/package.json').version).toBe('1.0.0')
  })
})

describe('Soft-Fork Operations CLI — update-methodology & audit-overrides', { timeout: 30_000 }, () => {
  it('updates resources/strataharness to a target Git tag and rejects missing methodology entrypoints', () => {
    const methodologyOrigin = createTempDir('strata-methodology-origin-')
    initGitRepo(methodologyOrigin)
    writeText(methodologyOrigin, 'AGENTS.md', '# Methodology v1.4.0\n')
    writeText(methodologyOrigin, '.agents/skills/tdd/SKILL.md', '# TDD v1.4.0\n')
    runGit(methodologyOrigin, ['add', '.'])
    runGit(methodologyOrigin, ['commit', '-m', 'chore: release v1.4.0'])
    runGit(methodologyOrigin, ['tag', 'v1.4.0'])

    const repoRoot = createCompliantFilesystemFixture()
    rmSync(join(repoRoot, 'resources/strataharness'), { recursive: true, force: true })
    runGit(repoRoot, ['clone', methodologyOrigin, join(repoRoot, 'resources/strataharness')])

    // Advance upstream methodology origin with v1.5.0 (valid) and v1.6.0-broken (missing .agents/skills).
    writeText(methodologyOrigin, 'AGENTS.md', '# Methodology v1.5.0\n')
    writeText(methodologyOrigin, '.agents/skills/tdd/SKILL.md', '# TDD v1.5.0\n')
    runGit(methodologyOrigin, ['add', '.'])
    runGit(methodologyOrigin, ['commit', '-m', 'chore: release v1.5.0'])
    runGit(methodologyOrigin, ['tag', 'v1.5.0'])

    rmSync(join(methodologyOrigin, '.agents'), { recursive: true, force: true })
    runGit(methodologyOrigin, ['add', '-A'])
    runGit(methodologyOrigin, ['commit', '-m', 'chore: broken layout'])
    runGit(methodologyOrigin, ['tag', 'v1.6.0-broken'])

    const updatedCli = runForkOpsCli(['update-methodology', '--remote', '--ref', 'v1.5.0'], { repoRoot })
    expect(updatedCli.exitCode).toBe(0)
    expect(readFileSync(join(repoRoot, 'resources/strataharness/AGENTS.md'), 'utf8')).toContain('v1.5.0')

    expect(() => updateMethodologySubmodule({ repoRoot, ref: 'v1.6.0-broken' })).toThrow(/\.agents\/skills|entrypoint/i)
  })

  it('passes audit-overrides on a compliant tree and fails on stray workflows, active dependabot config, version drift, broken isolation, or empty submodule', () => {
    const repoRoot = createCompliantFilesystemFixture()

    const cleanReport = auditForkOverrides(repoRoot)
    expect(cleanReport.ok).toBe(true)
    expect(cleanReport.violations).toEqual([])
    const cleanCli = runForkOpsCli(['audit-overrides'], { repoRoot })
    expect(cleanCli.exitCode).toBe(0)

    // (a) Stray upstream workflow in .github/workflows/
    writeText(repoRoot, '.github/workflows/ci.yml', 'name: Stray Upstream CI\n')
    const strayWorkflowCli = runForkOpsCli(['audit-overrides', '--json'], { repoRoot })
    expect(strayWorkflowCli.exitCode).toBe(1)
    expect(strayWorkflowCli.stdout).toContain('ci.yml')
    rmSync(join(repoRoot, '.github/workflows/ci.yml'), { force: true })

    // (a2) Active Dependabot config in .github/dependabot.{yml,yaml}
    writeText(repoRoot, '.github/dependabot.yml', 'version: 2\nupdates: []\n')
    const strayDependabotCli = runForkOpsCli(['audit-overrides', '--json'], { repoRoot })
    expect(strayDependabotCli.exitCode).toBe(1)
    expect(strayDependabotCli.stdout).toContain('.github/dependabot.yml')
    expect(strayDependabotCli.stdout).toContain('.github/upstream-workflows/')
    rmSync(join(repoRoot, '.github/dependabot.yml'), { force: true })

    writeText(repoRoot, '.github/dependabot.yaml', 'version: 2\nupdates: []\n')
    const strayDependabotYamlReport = auditForkOverrides(repoRoot)
    expect(strayDependabotYamlReport.ok).toBe(false)
    expect(strayDependabotYamlReport.violations.join('\n')).toContain('.github/dependabot.yaml')
    rmSync(join(repoRoot, '.github/dependabot.yaml'), { force: true })

    rmSync(join(repoRoot, '.github/upstream-workflows/dependabot.yml'), { force: true })
    const missingArchiveDependabotReport = auditForkOverrides(repoRoot)
    expect(missingArchiveDependabotReport.ok).toBe(false)
    expect(missingArchiveDependabotReport.violations.join('\n')).toContain('.github/upstream-workflows/dependabot.yml')
    writeText(repoRoot, '.github/upstream-workflows/dependabot.yml', 'version: 2\nupdates: []\n')

    // (b) @strata/* version drift
    writeJson(repoRoot, 'packages/strata/ui-brand/package.json', {
      name: '@strata/ui-brand',
      version: '1.0.9',
    })
    const driftReport = auditForkOverrides(repoRoot)
    expect(driftReport.ok).toBe(false)
    expect(driftReport.violations.join('\n')).toMatch(/@strata\/ui-brand|1\.0\.9/)
    writeJson(repoRoot, 'packages/strata/ui-brand/package.json', {
      name: '@strata/ui-brand',
      version: '1.0.0',
    })

    // (c) Broken Phase 3 desktop isolation (appId + download.deepseek.com)
    writeText(
      repoRoot,
      'apps/desktop/scripts/strata-desktop-config.mjs',
      [
        "export const STRATA_DESKTOP_PACKAGE_NAME = '@strata/desktop'",
        "export const STRATA_DESKTOP_APP_ID = 'com.deepseek.harness'",
        "export const STRATA_DESKTOP_URL_SCHEME = 'strata'",
        "export const STRATA_PRODUCTION_UPDATE_FIXED_ORIGIN = 'https://download.deepseek.com'",
        '',
      ].join('\n'),
    )
    const brokenIsolationReport = auditForkOverrides(repoRoot)
    expect(brokenIsolationReport.ok).toBe(false)
    expect(brokenIsolationReport.violations.join('\n')).toMatch(/com\.nikl\.strataharness/)
    expect(brokenIsolationReport.violations.join('\n')).toMatch(/download\.deepseek\.com|STRATA_PRODUCTION_UPDATE_FIXED_ORIGIN/)

    // Restore desktop config, then break Phase 1 bundle wiring and ~/.strataharness home isolation
    populateCompliantFilesystem(repoRoot)
    writeText(repoRoot, 'apps/desktop/src/paths.ts', "export const STRATA_HOME_DIR_NAME = '.dsh'\n")
    writeText(
      repoRoot,
      'packages/boot/app-boot/src/profile.ts',
      "export const PROFILE_TEMPLATES = { web: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } }\n",
    )
    const brokenHomeAndBundle = auditForkOverrides(repoRoot)
    expect(brokenHomeAndBundle.ok).toBe(false)
    expect(brokenHomeAndBundle.violations.join('\n')).toMatch(/\.strataharness/)
    expect(brokenHomeAndBundle.violations.join('\n')).toMatch(/@strata\/product-bundle/)

    // (d) Empty resources/strataharness submodule
    populateCompliantFilesystem(repoRoot)
    rmSync(join(repoRoot, 'resources/strataharness'), { recursive: true, force: true })
    mkdirSync(join(repoRoot, 'resources/strataharness'), { recursive: true })
    const emptySubmoduleReport = auditForkOverrides(repoRoot)
    expect(emptySubmoduleReport.ok).toBe(false)
    expect(emptySubmoduleReport.violations.join('\n')).toMatch(/resources\/strataharness/)
  })
})

describe('Soft-Fork Operations CLI — check-upstream & prepare-upstream-sync', { timeout: 30_000 }, () => {
  it('detects newer dsh-v* tags, computes overlapping strata(override) files and upgrade guides, blocks dirty trees, and creates sync/<tag>', () => {
    const upstreamRepo = createTempDir('strata-upstream-origin-')
    initGitRepo(upstreamRepo)
    writeJson(upstreamRepo, 'package.json', { name: '@deepseek-ai/dsh-monorepo', version: '0.2.1-rc.4' })
    writeText(upstreamRepo, 'packages/boot/app-boot/src/profile.ts', 'export const BUNDLES = ["base"]\n')
    writeText(upstreamRepo, 'packages/core/agent/src/index.ts', 'export const AGENT = 1\n')
    runGit(upstreamRepo, ['add', '.'])
    runGit(upstreamRepo, ['commit', '-m', 'chore: upstream dsh-v0.2.1-rc.4'])
    runGit(upstreamRepo, ['tag', 'dsh-v0.2.1-rc.4'])

    const forkParent = createTempDir('strata-fork-clone-')
    const forkRepo = join(forkParent, 'fork')
    runGit(forkParent, ['clone', upstreamRepo, forkRepo])
    runGit(forkRepo, ['remote', 'rename', 'origin', 'upstream'])

    writeJson(forkRepo, 'strata-product.json', {
      productName: 'StrataHarness',
      productVersion: '1.0.0',
      upstreamBaseTag: 'dsh-v0.2.1-rc.4',
      upstreamRepository: upstreamRepo,
    })
    writeText(forkRepo, 'packages/boot/app-boot/src/profile.ts', 'export const BUNDLES = ["base", "@strata/product-bundle"]\n')
    runGit(forkRepo, ['add', 'strata-product.json', 'packages/boot/app-boot/src/profile.ts'])
    runGit(forkRepo, ['commit', '-m', 'strata(override): wire @strata/product-bundle into web profile'])

    // Non-override commit touching another file must NOT be reported as a strata(override) conflict hotspot.
    writeText(forkRepo, 'packages/strata/notes.txt', 'strata-owned\n')
    runGit(forkRepo, ['add', 'packages/strata/notes.txt'])
    runGit(forkRepo, ['commit', '-m', 'feat(strata): add strata notes'])

    // Before upstream advances, check-upstream reports upToDate: true.
    const upToDateReport = checkUpstreamReleases({ repoRoot: forkRepo })
    expect(upToDateReport.upToDate).toBe(true)
    expect(upToDateReport.newerTags).toEqual([])
    expect(upToDateReport.latestTag).toBeNull()

    // Upstream releases dsh-v0.2.2 and dsh-v0.3.0 with overlapping profile edit, upgrade-guide, and new workflow.
    writeText(upstreamRepo, 'packages/core/agent/src/index.ts', 'export const AGENT = 2\n')
    runGit(upstreamRepo, ['add', '.'])
    runGit(upstreamRepo, ['commit', '-m', 'feat: release 0.2.2'])
    runGit(upstreamRepo, ['tag', 'dsh-v0.2.2'])

    writeText(upstreamRepo, 'packages/boot/app-boot/src/profile.ts', 'export const BUNDLES = ["base", "upstream-new"]\n')
    writeText(upstreamRepo, 'docs/upgrade-guide/v0.3.0/item/guide.md', '# Upgrade to v0.3.0\n')
    writeText(upstreamRepo, '.github/workflows/new-upstream-check.yml', 'name: New Upstream Check\n')
    writeText(upstreamRepo, '.github/dependabot.yaml', 'version: 2\nupdates: []\n')
    runGit(upstreamRepo, ['add', '.'])
    runGit(upstreamRepo, ['commit', '-m', 'feat: release 0.3.0'])
    runGit(upstreamRepo, ['tag', 'dsh-v0.3.0'])

    const radarJsonCli = runForkOpsCli(['check-upstream', '--remote-url', upstreamRepo, '--fetch', '--json'], {
      repoRoot: forkRepo,
    })
    expect(radarJsonCli.exitCode).toBe(0)
    const radarReport: unknown = JSON.parse(radarJsonCli.stdout)
    expect(radarReport).toMatchObject({
      upToDate: false,
      upstreamBaseTag: 'dsh-v0.2.1-rc.4',
      newerTags: ['dsh-v0.2.2', 'dsh-v0.3.0'],
      latestTag: 'dsh-v0.3.0',
      impactAvailable: true,
      overlappingOverrideFiles: ['packages/boot/app-boot/src/profile.ts'],
      upgradeGuides: ['docs/upgrade-guide/v0.3.0/item/guide.md'],
      newUpstreamWorkflows: ['.github/dependabot.yaml', '.github/workflows/new-upstream-check.yml'],
    })

    const radarMdCli = runForkOpsCli(['check-upstream', '--local', '--markdown'], { repoRoot: forkRepo })
    expect(radarMdCli.exitCode).toBe(0)
    expect(radarMdCli.stdout).toContain('dsh-v0.3.0')
    expect(radarMdCli.stdout).toContain('packages/boot/app-boot/src/profile.ts')
    expect(radarMdCli.stdout).toContain('docs/upgrade-guide/v0.3.0/item/guide.md')
    expect(radarMdCli.stdout).toContain('.github/workflows/new-upstream-check.yml')

    // Dirty working tree MUST block both check-upstream (unless --allow-dirty) and prepare-upstream-sync.
    writeText(forkRepo, 'dirty.tmp', 'uncommitted\n')
    expect(() => checkUpstreamReleases({ repoRoot: forkRepo, local: true })).toThrow(/dirty|uncommitted/i)
    const dirtyCheckCli = runForkOpsCli(['check-upstream', '--local'], { repoRoot: forkRepo })
    expect(dirtyCheckCli.exitCode).toBe(1)
    const allowDirtyCheckCli = runForkOpsCli(['check-upstream', '--local', '--allow-dirty'], { repoRoot: forkRepo })
    expect(allowDirtyCheckCli.exitCode).toBe(0)
    expect(() => prepareUpstreamSync({ repoRoot: forkRepo, targetTag: 'dsh-v0.3.0', noFetch: true })).toThrow(/dirty|uncommitted/i)
    const dirtySyncCli = runForkOpsCli(['prepare-upstream-sync', 'dsh-v0.3.0', '--no-fetch'], { repoRoot: forkRepo })
    expect(dirtySyncCli.exitCode).toBe(1)
    expect(runGit(forkRepo, ['branch', '--show-current'])).toBe('main')

    // Rejects leading-dash Git option injection and unconfigured protocols on --remote-url.
    rmSync(join(forkRepo, 'dirty.tmp'), { force: true })
    expect(() => checkUpstreamReleases({ repoRoot: forkRepo, remoteUrl: '--upload-pack=evil' })).toThrow(/must not start with "-"/u)
    expect(() => checkUpstreamReleases({ repoRoot: forkRepo, remoteUrl: 'ext::sh -c evil' })).toThrow(/remoteUrl/u)

    // Detects strata(override): commits even under grep.patternType=perl and --no-ff merge commits.
    runGit(forkRepo, ['config', 'grep.patternType', 'perl'])
    runGit(forkRepo, ['checkout', '-b', 'feature/agent-override'])
    writeText(forkRepo, 'packages/core/agent/src/index.ts', 'export const AGENT = 99\n')
    runGit(forkRepo, ['add', 'packages/core/agent/src/index.ts'])
    runGit(forkRepo, ['commit', '-m', 'chore: branch work before override merge'])
    runGit(forkRepo, ['checkout', 'main'])
    runGit(forkRepo, ['merge', '--no-ff', 'feature/agent-override', '-m', 'strata(override): merge agent override'])

    expect(getForkStatus(forkRepo).overrideCommitCount).toBe(2)
    const perlMergeImpact = checkUpstreamReleases({ repoRoot: forkRepo, local: true })
    expect(perlMergeImpact.overrideFiles).toEqual([
      'packages/boot/app-boot/src/profile.ts',
      'packages/core/agent/src/index.ts',
      'strata-product.json',
    ])
    expect(perlMergeImpact.overlappingOverrideFiles).toEqual([
      'packages/boot/app-boot/src/profile.ts',
      'packages/core/agent/src/index.ts',
    ])

    // Clean working tree creates sync/dsh-v0.3.0 and outputs the impact report + 5-step merge checklist.
    const cleanSyncCli = runForkOpsCli(['prepare-upstream-sync', 'dsh-v0.3.0'], { repoRoot: forkRepo })
    expect(cleanSyncCli.exitCode).toBe(0)
    expect(runGit(forkRepo, ['branch', '--show-current'])).toBe('sync/dsh-v0.3.0')
    expect(cleanSyncCli.stdout).toContain('git merge --no-commit dsh-v0.3.0')
    expect(cleanSyncCli.stdout).toContain('.github/upstream-workflows/')
    expect(cleanSyncCli.stdout).toContain('strata:audit-overrides')
    expect(cleanSyncCli.stdout).toContain('strata:version minor --upstream-base dsh-v0.3.0')
    expect(cleanSyncCli.stdout).toContain('test:updates:local')
  })
})

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

describe('Strata Upstream Release Radar Workflow & Real Repository Audit', () => {
  const realRepoRoot = resolve(import.meta.dirname, '../..')

  it('defines strata-upstream-watch.yml with daily schedule, env-bound inputs, minimal permissions, single-issue deduplication, and zero client coupling', () => {
    const workflowPath = join(realRepoRoot, '.github/workflows/strata-upstream-watch.yml')
    const rawYaml = readFileSync(workflowPath, 'utf8')
    const parsed: unknown = yaml.load(rawYaml)
    if (!isPlainRecord(parsed)) {
      throw new Error('strata-upstream-watch.yml must parse to a YAML mapping')
    }

    // Triggers: schedule (daily cron) + workflow_dispatch (upstream_url, dry_run)
    if (!isPlainRecord(parsed.on)) {
      throw new Error('strata-upstream-watch.yml must define on triggers')
    }
    expect(Array.isArray(parsed.on.schedule)).toBe(true)
    expect(parsed.on.schedule).toEqual([{ cron: '0 7 * * *' }])
    expect(parsed.on.workflow_dispatch).toMatchObject({
      inputs: {
        upstream_url: { type: 'string', required: false, default: '' },
        dry_run: { type: 'boolean', required: false, default: false },
      },
    })

    // Minimal top-level permissions and concurrency group
    expect(parsed.permissions).toEqual({ contents: 'read' })
    expect(parsed.concurrency).toEqual({
      group: 'strata-upstream-watch',
      'cancel-in-progress': true,
    })

    if (!isPlainRecord(parsed.jobs) || !isPlainRecord(parsed.jobs.radar)) {
      throw new Error('strata-upstream-watch.yml must define jobs.radar')
    }
    const radar = parsed.jobs.radar
    expect(radar['runs-on']).toBe('ubuntu-24.04')
    expect(radar.permissions).toEqual({
      contents: 'read',
      issues: 'write',
    })

    if (!Array.isArray(radar.steps)) {
      throw new Error('jobs.radar must define steps')
    }

    // Security invariant: zero ${{ inputs.* }} or ${{ secrets.* }} inside run: shell scripts
    const runScripts: string[] = []
    for (const step of radar.steps) {
      if (!isPlainRecord(step)) continue
      if (typeof step.run === 'string') {
        expect(step.run).not.toContain('${{ inputs.')
        expect(step.run).not.toContain('${{ secrets.')
        runScripts.push(step.run)
      }
    }

    // Full history checkout for strata(override) commit inspection
    const checkoutStep = radar.steps.find(
      (step): step is Record<string, unknown> => isPlainRecord(step) && typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@'),
    )
    expect(checkoutStep?.with).toMatchObject({ 'fetch-depth': 0 })

    // Single-issue deduplication via strata:upstream-radar, step summary, and optional webhook
    const combinedRuns = runScripts.join('\n')
    expect(combinedRuns).toContain('strata:check-upstream')
    expect(combinedRuns).toContain('GITHUB_STEP_SUMMARY')
    expect(combinedRuns).toContain('strata:upstream-radar')
    expect(combinedRuns).toContain('gh issue list')
    expect(combinedRuns).toContain('gh issue edit')
    expect(combinedRuns).toContain('gh issue create')
    expect(rawYaml).toContain('STRATA_ARCHITECT_WEBHOOK_URL')

    // Zero references to strata-upstream-watch inside packages/ or apps/
    const grepResult = spawnSync('git', ['grep', '-l', 'strata-upstream-watch', '--', 'packages', 'apps'], {
      cwd: realRepoRoot,
      encoding: 'utf8',
    })
    expect(grepResult.error).toBeUndefined()
    expect(grepResult.stdout.trim()).toBe('')
  })

  it('passes strata:audit-overrides against the real repository root and keeps dependabot.yml archived under .github/upstream-workflows/', () => {
    const report = auditForkOverrides(realRepoRoot)
    expect(report.violations).toEqual([])
    expect(report.ok).toBe(true)
    expect(existsSync(join(realRepoRoot, '.github/dependabot.yml'))).toBe(false)
    expect(existsSync(join(realRepoRoot, '.github/dependabot.yaml'))).toBe(false)
    expect(existsSync(join(realRepoRoot, '.github/upstream-workflows/dependabot.yml'))).toBe(true)
  })
})
