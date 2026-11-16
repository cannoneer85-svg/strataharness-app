/** Contract and behavioral tests for StrataHarness CI/release helper and `.github/workflows/strata-*.yml`. */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import yaml from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { auditForkOverrides } from './fork-ops.ts'
import {
  collectReleaseArtifacts,
  computeSha256Sums,
  parseReleaseTargets,
  runReleaseHelperCli,
  runReleasePreflight,
  stagePackagedTarget,
} from './release-helper.ts'

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

function createReleaseRepoFixture(overrides?: {
  readonly productVersion?: string
  readonly engineVersion?: string
  readonly upstreamBaseTag?: string
  readonly omitMethodologySkills?: boolean
  readonly methodologyVersion?: string
}): string {
  const repoRoot = createTempDir('strata-release-fixture-')
  writeJson(repoRoot, 'package.json', {
    name: '@deepseek-ai/dsh-root',
    version: overrides?.engineVersion ?? '0.2.1-rc.4',
    private: true,
    type: 'module',
  })
  writeJson(repoRoot, 'strata-product.json', {
    productName: 'StrataHarness',
    productVersion: overrides?.productVersion ?? '1.0.0',
    upstreamBaseTag: overrides?.upstreamBaseTag ?? 'dsh-v0.2.1-rc.4',
    upstreamRepository: 'https://github.com/deepseek-ai/deepseek-harness.git',
    releaseRepository: 'https://github.com/cannoneer85-svg/strataharness-app.git',
  })
  if (overrides?.omitMethodologySkills !== true) {
    writeText(repoRoot, 'resources/strataharness/AGENTS.md', '# StrataHarness Methodology\n')
    writeText(repoRoot, 'resources/strataharness/.agents/skills/tdd/SKILL.md', '# TDD\n')
    writeText(repoRoot, 'resources/strataharness/VERSION', `${overrides?.methodologyVersion ?? '1.4.2'}\n`)
  }
  return repoRoot
}

afterEach(() => {
  for (const dir of tempDirectories.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('StrataHarness release preflight & target routing', () => {
  it('validates tag parity against strata-product.json, verifies methodology submodule, and writes GITHUB_OUTPUT', () => {
    const repoRoot = createReleaseRepoFixture({ methodologyVersion: '1.4.2' })
    const outputFile = join(repoRoot, 'github-output.txt')

    const result = runReleasePreflight({
      repoRoot,
      eventName: 'push',
      gitRef: 'refs/tags/strata-v1.0.0',
      targets: 'all',
      githubOutputPath: outputFile,
    })

    expect(result).toEqual({
      productName: 'StrataHarness',
      productVersion: '1.0.0',
      engineVersion: '0.2.1-rc.4',
      upstreamBaseTag: 'dsh-v0.2.1-rc.4',
      methodologyRevision: 'v1.4.2',
      releaseTag: 'strata-v1.0.0',
      targets: ['win-x64', 'mac-arm64', 'mac-x64'],
      runWindows: true,
      runMacos: true,
      macosTargets: 'all',
      isDraft: false,
      isPrerelease: false,
    })

    const outputText = readFileSync(outputFile, 'utf8')
    expect(outputText).toContain('version=1.0.0\n')
    expect(outputText).toContain('engine_version=0.2.1-rc.4\n')
    expect(outputText).toContain('upstream_base_tag=dsh-v0.2.1-rc.4\n')
    expect(outputText).toContain('release_tag=strata-v1.0.0\n')
    expect(outputText).toContain('run_windows=true\n')
    expect(outputText).toContain('run_macos=true\n')
    expect(outputText).toContain('macos_targets=all\n')
    expect(outputText).toContain('is_draft=false\n')
    expect(outputText).toContain('is_prerelease=false\n')
  })

  it('fails fast when strata-v* tag does not match strata-product.json productVersion or uses a non-strata tag', () => {
    const repoRoot = createReleaseRepoFixture({ productVersion: '1.0.0' })

    expect(() =>
      runReleasePreflight({
        repoRoot,
        eventName: 'push',
        gitRef: 'refs/tags/strata-v1.0.1',
      }),
    ).toThrow(/strata-v1\.0\.1.*1\.0\.0/u)

    expect(() =>
      runReleasePreflight({
        repoRoot,
        eventName: 'push',
        gitRef: 'refs/tags/dsh-v0.2.1-rc.4',
      }),
    ).toThrow(/strata-v/u)
  })

  it('fails fast when resources/strataharness submodule is uninitialized or empty', () => {
    const repoRoot = createReleaseRepoFixture({ omitMethodologySkills: true })
    mkdirSync(join(repoRoot, 'resources', 'strataharness'), { recursive: true })

    expect(() =>
      runReleasePreflight({
        repoRoot,
        eventName: 'push',
        gitRef: 'refs/tags/strata-v1.0.0',
      }),
    ).toThrow(/resources\/strataharness/u)
  })

  it('blocks subset targets for production releases and allows subset routing only for draft or prerelease runs', () => {
    const repoRoot = createReleaseRepoFixture({ productVersion: '1.0.0' })

    expect(parseReleaseTargets('mac-x64,win-x64')).toEqual(['win-x64', 'mac-x64'])
    expect(() => parseReleaseTargets('linux-x64')).toThrow(/unsupported release target/iu)

    expect(() =>
      runReleasePreflight({
        repoRoot,
        eventName: 'workflow_dispatch',
        gitRef: 'refs/heads/main',
        targets: 'win-x64',
        draft: false,
        prerelease: false,
      }),
    ).toThrow(/draft|prerelease/iu)

    const winDraft = runReleasePreflight({
      repoRoot,
      eventName: 'workflow_dispatch',
      gitRef: 'refs/heads/main',
      targets: 'win-x64',
      draft: true,
      prerelease: false,
    })
    expect(winDraft.runWindows).toBe(true)
    expect(winDraft.runMacos).toBe(false)
    expect(winDraft.macosTargets).toBe('none')
    expect(winDraft.isDraft).toBe(true)

    const macArmPrerelease = runReleasePreflight({
      repoRoot,
      eventName: 'workflow_dispatch',
      gitRef: 'refs/heads/main',
      targets: 'mac-arm64',
      draft: false,
      prerelease: true,
    })
    expect(macArmPrerelease.runWindows).toBe(false)
    expect(macArmPrerelease.runMacos).toBe(true)
    expect(macArmPrerelease.macosTargets).toBe('mac-arm64')
    expect(macArmPrerelease.isPrerelease).toBe(true)
  })
})

function sha256Text(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

describe('StrataHarness target staging, atomic collection, checksums, release notes, and update feed', () => {
  it('stages unsigned and signed target outputs while stripping unpacked directories and unsigned updater metadata', () => {
    const repoRoot = createReleaseRepoFixture({ methodologyVersion: '1.4.2' })
    const winSource = join(repoRoot, 'win-unsigned-out')
    writeText(winSource, 'strataharness-1.0.0-win-x64-unsigned.exe', 'win-unsigned-installer-bytes')
    writeText(winSource, 'win-unpacked/StrataHarness.exe', 'unpacked-tree-should-not-stage')
    writeText(winSource, 'latest.yml', 'version: 1.0.0\n')

    const winSummary = join(repoRoot, 'win-summary.md')
    const winStageOut = join(repoRoot, 'staged-win-x64')
    const winStaged = stagePackagedTarget({
      repoRoot,
      target: 'win-x64',
      requestedSigningMode: 'auto',
      effectiveSigningMode: 'unsigned',
      sourceDir: winSource,
      outDir: winStageOut,
      stepSummaryPath: winSummary,
    })

    expect(winStaged.manifest.effectiveSigningMode).toBe('unsigned')
    expect(winStaged.manifest.updateFeedEnabled).toBe(false)
    expect(readdirSync(winStageOut).sort()).toEqual([
      'strata-target-manifest.json',
      'strataharness-1.0.0-win-x64-unsigned.exe',
    ])
    expect(readFileSync(winSummary, 'utf8')).toContain('win-x64')
    expect(readFileSync(winSummary, 'utf8')).toContain('auto')
    expect(readFileSync(winSummary, 'utf8')).toContain('unsigned')

    const macMissingZipSource = join(repoRoot, 'mac-missing-zip')
    writeText(macMissingZipSource, 'strataharness-1.0.0-mac-arm64-unsigned.dmg', 'dmg-only')
    expect(() =>
      stagePackagedTarget({
        repoRoot,
        target: 'mac-arm64',
        requestedSigningMode: 'unsigned',
        effectiveSigningMode: 'unsigned',
        sourceDir: macMissingZipSource,
        outDir: join(repoRoot, 'staged-mac-fail'),
      }),
    ).toThrow(/strataharness-1\.0\.0-mac-arm64-unsigned\.zip/u)
  })

  it('collects an unsigned 3-target production release with SHA256SUMS.txt, dual-track release notes, Gatekeeper/SmartScreen guidance, and no latest*.yml', () => {
    const repoRoot = createReleaseRepoFixture({ methodologyVersion: '1.4.2' })
    const artifactsDir = join(repoRoot, 'downloaded')

    writeText(artifactsDir, 'strata-dist-win-x64/strataharness-1.0.0-win-x64-unsigned.exe', 'win-exe-payload')
    writeText(artifactsDir, 'strata-dist-mac-arm64/strataharness-1.0.0-mac-arm64-unsigned.dmg', 'mac-arm64-dmg-payload')
    writeText(artifactsDir, 'strata-dist-mac-arm64/strataharness-1.0.0-mac-arm64-unsigned.zip', 'mac-arm64-zip-payload')
    writeText(artifactsDir, 'strata-dist-mac-x64/strataharness-1.0.0-mac-x64-unsigned.dmg', 'mac-x64-dmg-payload')
    writeText(artifactsDir, 'strata-dist-mac-x64/strataharness-1.0.0-mac-x64-unsigned.zip', 'mac-x64-zip-payload')

    const bundleDir = join(repoRoot, 'bundle-unsigned')
    const collected = collectReleaseArtifacts({
      repoRoot,
      artifactsDir,
      outDir: bundleDir,
      targets: 'all',
      draft: false,
      prerelease: false,
    })

    expect(collected.feedReady).toBe(false)
    expect(readdirSync(collected.releaseAssetsDir).sort()).toEqual([
      'SHA256SUMS.txt',
      'strataharness-1.0.0-mac-arm64-unsigned.dmg',
      'strataharness-1.0.0-mac-arm64-unsigned.zip',
      'strataharness-1.0.0-mac-x64-unsigned.dmg',
      'strataharness-1.0.0-mac-x64-unsigned.zip',
      'strataharness-1.0.0-win-x64-unsigned.exe',
    ])

    const expectedWinHash = sha256Text('win-exe-payload')
    expect(collected.sha256SumsContent).toContain(`${expectedWinHash}  strataharness-1.0.0-win-x64-unsigned.exe\n`)
    expect(
      computeSha256Sums([
        {
          filename: 'strataharness-1.0.0-win-x64-unsigned.exe',
          filePath: join(collected.releaseAssetsDir, 'strataharness-1.0.0-win-x64-unsigned.exe'),
        },
      ]),
    ).toBe(`${expectedWinHash}  strataharness-1.0.0-win-x64-unsigned.exe\n`)

    expect(collected.releaseNotesMarkdown).toContain('StrataHarness v1.0.0')
    expect(collected.releaseNotesMarkdown).toContain('Engine: DSH 0.2.1-rc.4 (dsh-v0.2.1-rc.4)')
    expect(collected.releaseNotesMarkdown).toContain('v1.4.2')
    expect(collected.releaseNotesMarkdown).toContain('xattr -cr /Applications/StrataHarness.app')
    expect(collected.releaseNotesMarkdown).toContain('Open Anyway')
    expect(collected.releaseNotesMarkdown).toContain('SmartScreen')
    expect(collected.releaseNotesMarkdown).toContain('Run anyway')

    expect(existsSync(join(collected.updateFeedDir, 'feed-manifest.json'))).toBe(true)
    expect(existsSync(join(collected.updateFeedDir, 'strataharness'))).toBe(false)
  })

  it('assembles strataharness/feeds/<target>/ update feed and omits unsigned warnings when all 3 targets are signed with feed metadata', () => {
    const repoRoot = createReleaseRepoFixture({ methodologyVersion: '1.5.0' })
    const rawOut = join(repoRoot, 'raw-signed')
    const downloaded = join(repoRoot, 'downloaded-signed')

    const winDir = join(rawOut, 'win-x64')
    writeText(winDir, 'strataharness-1.0.0-win-x64.exe', 'signed-win-exe')
    writeText(winDir, 'strataharness-1.0.0-win-x64.exe.blockmap', 'signed-win-blockmap')
    writeText(winDir, 'latest.yml', 'version: 1.0.0\npath: strataharness-1.0.0-win-x64.exe\n')
    stagePackagedTarget({
      repoRoot,
      target: 'win-x64',
      requestedSigningMode: 'signed',
      effectiveSigningMode: 'signed',
      sourceDir: winDir,
      outDir: join(downloaded, 'strata-dist-win-x64'),
    })

    for (const macTarget of ['mac-arm64', 'mac-x64'] as const) {
      const macDir = join(rawOut, macTarget)
      writeText(macDir, `strataharness-1.0.0-${macTarget}.dmg`, `signed-${macTarget}-dmg`)
      writeText(macDir, `strataharness-1.0.0-${macTarget}.zip`, `signed-${macTarget}-zip`)
      writeText(macDir, `strataharness-1.0.0-${macTarget}.zip.blockmap`, `signed-${macTarget}-blockmap`)
      writeText(macDir, 'latest-mac.yml', `version: 1.0.0\npath: strataharness-1.0.0-${macTarget}.zip\n`)
      stagePackagedTarget({
        repoRoot,
        target: macTarget,
        requestedSigningMode: 'signed',
        effectiveSigningMode: 'signed',
        sourceDir: macDir,
        outDir: join(downloaded, `strata-dist-${macTarget}`),
      })
    }

    const ghOut = join(repoRoot, 'collect-output.txt')
    const bundleDir = join(repoRoot, 'bundle-signed')
    const collected = collectReleaseArtifacts({
      repoRoot,
      artifactsDir: downloaded,
      outDir: bundleDir,
      targets: 'all',
      githubOutputPath: ghOut,
    })

    expect(collected.feedReady).toBe(true)
    expect(readFileSync(ghOut, 'utf8')).toContain('feed_ready=true\n')
    expect(existsSync(join(collected.updateFeedDir, 'strataharness/feeds/win-x64/latest.yml'))).toBe(true)
    expect(existsSync(join(collected.updateFeedDir, 'strataharness/feeds/win-x64/strataharness-1.0.0-win-x64.exe'))).toBe(true)
    expect(existsSync(join(collected.updateFeedDir, 'strataharness/feeds/win-x64/strataharness-1.0.0-win-x64.exe.blockmap'))).toBe(true)
    expect(existsSync(join(collected.updateFeedDir, 'strataharness/feeds/mac-arm64/latest-mac.yml'))).toBe(true)
    expect(existsSync(join(collected.updateFeedDir, 'strataharness/feeds/mac-arm64/strataharness-1.0.0-mac-arm64.zip'))).toBe(true)
    expect(existsSync(join(collected.updateFeedDir, 'strataharness/feeds/mac-x64/latest-mac.yml'))).toBe(true)
    expect(existsSync(join(collected.updateFeedDir, 'strataharness/feeds/mac-x64/strataharness-1.0.0-mac-x64.zip'))).toBe(true)

    expect(collected.releaseNotesMarkdown).not.toContain('xattr -cr /Applications/StrataHarness.app')
    expect(collected.releaseNotesMarkdown).toContain('signed')
  })

  it('enforces the 3-target atomic gate on collect for production releases while allowing single-target draft/prerelease CLI collection', () => {
    const repoRoot = createReleaseRepoFixture()
    const partialArtifacts = join(repoRoot, 'partial-artifacts')
    writeText(partialArtifacts, 'strata-dist-win-x64/strataharness-1.0.0-win-x64-unsigned.exe', 'win-only-exe')

    expect(() =>
      collectReleaseArtifacts({
        repoRoot,
        artifactsDir: partialArtifacts,
        outDir: join(repoRoot, 'fail-prod'),
        targets: 'all',
        draft: false,
        prerelease: false,
      }),
    ).toThrow(/mac-arm64/u)

    const cliFail = runReleaseHelperCli(
      ['preflight', '--event-name', 'push', '--git-ref', 'refs/tags/strata-v9.9.9'],
      { repoRoot },
    )
    expect(cliFail.exitCode).toBe(1)
    expect(cliFail.stderr).toContain('strata-v9.9.9')

    const draftOut = join(repoRoot, 'draft-win-bundle')
    const cliDraft = runReleaseHelperCli(
      [
        'collect',
        '--artifacts-dir',
        partialArtifacts,
        '--out-dir',
        draftOut,
        '--targets',
        'win-x64',
        '--draft',
      ],
      { repoRoot },
    )
    expect(cliDraft.exitCode).toBe(0)
    expect(existsSync(join(draftOut, 'RELEASE_NOTES.md'))).toBe(true)
    expect(existsSync(join(draftOut, 'release-assets/SHA256SUMS.txt'))).toBe(true)
  })
})

interface WorkflowStepDoc {
  readonly id?: string
  readonly name?: string
  readonly if?: string
  readonly 'continue-on-error'?: boolean | string
  readonly uses?: string
  readonly run?: string
  readonly shell?: string
  readonly env?: Record<string, string | number | boolean>
  readonly with?: Record<string, string | number | boolean>
}

interface WorkflowJobDoc {
  readonly name?: string
  readonly 'runs-on'?: string
  readonly 'timeout-minutes'?: number
  readonly needs?: string | readonly string[]
  readonly if?: string
  readonly 'continue-on-error'?: boolean | string
  readonly uses?: string
  readonly permissions?: Record<string, string>
  readonly defaults?: { readonly run?: { readonly shell?: string } }
  readonly concurrency?: {
    readonly group?: string
    readonly 'cancel-in-progress'?: boolean
  }
  readonly strategy?: {
    readonly 'fail-fast'?: boolean
    readonly matrix?: Record<string, unknown>
  }
  readonly outputs?: Record<string, string>
  readonly with?: Record<string, string | number | boolean>
  readonly secrets?: string | Record<string, string>
  readonly steps?: readonly WorkflowStepDoc[]
}

interface WorkflowDoc {
  readonly name: string
  readonly on: Record<string, unknown>
  readonly permissions?: Record<string, string> | undefined
  readonly jobs: Record<string, WorkflowJobDoc>
}

const REPO_ROOT = resolve(import.meta.dirname, '../..')

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function loadWorkflowYaml(filename: string): { readonly raw: string; readonly doc: WorkflowDoc } {
  const fullPath = resolve(REPO_ROOT, '.github/workflows', filename)
  const raw = readFileSync(fullPath, 'utf8')
  const loaded: unknown = yaml.load(raw)
  if (!isPlainObject(loaded) || typeof loaded.name !== 'string' || !isPlainObject(loaded.on) || !isPlainObject(loaded.jobs)) {
    throw new Error(`Invalid GitHub Actions workflow structure in ${filename}`)
  }
  return {
    raw,
    doc: {
      name: loaded.name,
      on: loaded.on,
      permissions: isPlainObject(loaded.permissions)
        ? Object.fromEntries(Object.entries(loaded.permissions).map(([key, val]) => [key, String(val)]))
        : undefined,
      jobs: loaded.jobs as Record<string, WorkflowJobDoc>,
    },
  }
}

describe('StrataHarness Windows and macOS reusable packaging workflows', () => {
  it('enforces Windows packaging runner, bsdtar PATH ordering, submodule checkout, RUNNER_TEMP .pfx cleanup, and diagnostic upload', () => {
    const { doc } = loadWorkflowYaml('strata-windows-package.yml')

    expect(doc.permissions).toEqual({ contents: 'read' })
    expect(doc.on).toHaveProperty('workflow_dispatch')
    expect(doc.on).toHaveProperty('workflow_call')

    const workflowCall = doc.on.workflow_call as {
      inputs: Record<string, { default?: unknown }>
      secrets: Record<string, unknown>
      outputs: Record<string, unknown>
    }
    expect(workflowCall.inputs.signing_mode?.default).toBe('auto')
    expect(workflowCall.secrets).toHaveProperty('STRATA_SUBMODULE_TOKEN')
    expect(workflowCall.secrets).toHaveProperty('WIN_CSC_LINK')
    expect(workflowCall.secrets).toHaveProperty('WIN_CSC_KEY_PASSWORD')
    expect(workflowCall.outputs).toHaveProperty('effective_signing_mode')
    expect(workflowCall.outputs).toHaveProperty('version')

    const job = doc.jobs.package
    expect(job).toBeDefined()
    expect(job?.['runs-on']).toBe('windows-2022')
    expect(job?.['timeout-minutes']).toBe(90)
    expect(job?.defaults?.run?.shell).toBe('pwsh')
    expect(job?.permissions).toEqual({ contents: 'read' })

    const steps = job?.steps ?? []
    const pathStep = steps.find(step => step.run?.includes('System32') && step.run.includes('tar.exe'))
    expect(pathStep).toBeDefined()

    const checkoutStep = steps.find(step => step.uses === 'actions/checkout@v7.0.1')
    expect(checkoutStep?.with?.submodules).toBe('recursive')
    expect(String(checkoutStep?.with?.token)).toContain('secrets.STRATA_SUBMODULE_TOKEN || github.token')
    expect(checkoutStep?.with?.['persist-credentials']).toBe(false)

    const allRunText = steps.map(step => step.run ?? '').join('\n')
    expect(allRunText).toContain('resources/strataharness/.agents/skills')
    expect(allRunText).toContain('pnpm run constraints')
    expect(allRunText).toContain('pnpm run strata:audit-overrides')
    expect(allRunText).toContain('--check')
    expect(allRunText).toContain('RUNNER_TEMP')
    expect(allRunText).toContain('.pfx')
    expect(allRunText).toContain('::add-mask::')
    expect(allRunText).toContain('release-helper.ts')
    expect(allRunText).toContain('stage-target')

    const distUpload = steps.find(
      step => step.uses === 'actions/upload-artifact@v7.0.1' && step.with?.name === 'strata-dist-win-x64',
    )
    expect(distUpload).toBeDefined()
    expect(distUpload?.with?.['retention-days']).toBe(1)

    const diagUpload = steps.find(
      step =>
        step.uses === 'actions/upload-artifact@v7.0.1'
        && String(step.with?.path ?? '').includes('packaging-runs'),
    )
    expect(diagUpload?.if).toBe('always()')
    expect(diagUpload?.with?.['retention-days']).toBe(1)
    expect(diagUpload?.['continue-on-error']).toBe(true)

    const cleanupStep = steps.find(
      step => step.if === 'always()' && (step.run ?? '').includes('strata-win-cert.pfx'),
    )
    expect(cleanupStep).toBeDefined()
  })

  it('enforces macOS native runners (macos-15 / macos-15-intel), uname -m guard, target-isolated cache keys, and .dmg+.zip staging', () => {
    const { doc } = loadWorkflowYaml('strata-macos-package.yml')

    expect(doc.permissions).toEqual({ contents: 'read' })
    expect(doc.on).toHaveProperty('workflow_dispatch')
    expect(doc.on).toHaveProperty('workflow_call')

    const workflowCall = doc.on.workflow_call as {
      inputs: Record<string, { default?: unknown }>
      secrets: Record<string, unknown>
    }
    expect(workflowCall.inputs.signing_mode?.default).toBe('auto')
    expect(workflowCall.inputs.targets?.default).toBe('all')
    expect(workflowCall.inputs.skip_notarization?.default).toBe(false)
    expect(workflowCall.secrets).toHaveProperty('STRATA_SUBMODULE_TOKEN')
    expect(workflowCall.secrets).toHaveProperty('CSC_LINK')
    expect(workflowCall.secrets).toHaveProperty('CSC_KEY_PASSWORD')
    expect(workflowCall.secrets).toHaveProperty('APPLE_API_KEY')

    const job = doc.jobs.package
    expect(job).toBeDefined()
    expect(job?.['runs-on']).toBe("${{ matrix.target == 'mac-x64' && 'macos-15-intel' || 'macos-15' }}")
    expect(job?.['timeout-minutes']).toBe(120)
    expect(job?.strategy?.['fail-fast']).toBe(false)
    expect(job?.permissions).toEqual({ contents: 'read' })

    const steps = job?.steps ?? []
    const rosettaStep = steps.find(step => (step.run ?? '').includes('--install-rosetta'))
    expect(rosettaStep).toBeUndefined()

    const archGuardStep = steps.find(step => (step.run ?? '').includes('/usr/bin/uname -m'))
    expect(archGuardStep).toBeDefined()
    expect(archGuardStep?.env?.MATRIX_TARGET).toBe('${{ matrix.target }}')
    expect(archGuardStep?.run).toContain('sysctl.proc_translated')
    expect(archGuardStep?.run).toContain('Rosetta-translated runner process detected')
    expect(archGuardStep?.run).toContain('mac-arm64) expected_arch="arm64"')
    expect(archGuardStep?.run).toContain('mac-x64) expected_arch="x86_64"')
    expect(archGuardStep?.run).toContain('Runner architecture mismatch')

    const pnpmCacheStep = steps.find(
      step => step.uses === 'actions/cache@v6.1.0' && String(step.with?.key ?? '').includes('-pnpm-'),
    )
    expect(pnpmCacheStep).toBeDefined()
    expect(String(pnpmCacheStep?.with?.key)).toContain('${{ matrix.target }}')
    const pnpmRestoreKeys = String(pnpmCacheStep?.with?.['restore-keys'] ?? '')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line !== '')
    expect(pnpmRestoreKeys).toEqual([
      '${{ runner.os }}-node-${{ env.PRIMARY_NODE_VERSION }}-strata-mac-${{ matrix.target }}-pnpm-',
    ])

    const runtimeCacheStep = steps.find(
      step =>
        step.uses === 'actions/cache@v6.1.0'
        && String(step.with?.key ?? '').includes('-strata-desktop-runtime-'),
    )
    expect(runtimeCacheStep).toBeDefined()
    expect(String(runtimeCacheStep?.with?.key)).toContain('${{ matrix.target }}')
    const runtimeRestoreKeys = String(runtimeCacheStep?.with?.['restore-keys'] ?? '')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line !== '')
    expect(runtimeRestoreKeys).toEqual(['${{ runner.os }}-${{ matrix.target }}-strata-desktop-runtime-'])

    const checkoutStep = steps.find(step => step.uses === 'actions/checkout@v7.0.1')
    expect(checkoutStep?.with?.submodules).toBe('recursive')
    expect(String(checkoutStep?.with?.token)).toContain('secrets.STRATA_SUBMODULE_TOKEN || github.token')

    const allRunText = steps.map(step => step.run ?? '').join('\n')
    expect(allRunText).toContain('resources/strataharness/.agents/skills')
    expect(allRunText).toContain('pnpm run constraints')
    expect(allRunText).toContain('pnpm run strata:audit-overrides')
    expect(allRunText).toContain('--check')
    expect(allRunText).toContain('RUNNER_TEMP')
    expect(allRunText).toContain('.p12')
    expect(allRunText).toContain('.p8')
    expect(allRunText).toContain('::add-mask::')
    expect(allRunText).toContain('stage-target')

    const distUpload = steps.find(
      step =>
        step.uses === 'actions/upload-artifact@v7.0.1'
        && step.with?.name === 'strata-dist-${{ matrix.target }}',
    )
    expect(distUpload).toBeDefined()
    expect(distUpload?.with?.['retention-days']).toBe(1)

    const diagUpload = steps.find(
      step =>
        step.uses === 'actions/upload-artifact@v7.0.1'
        && String(step.with?.path ?? '').includes('packaging-runs'),
    )
    expect(diagUpload?.if).toBe('always()')
    expect(diagUpload?.with?.['retention-days']).toBe(1)
    expect(diagUpload?.['continue-on-error']).toBe(true)

    const cleanupStep = steps.find(
      step =>
        step.if === 'always()'
        && (step.run ?? '').includes('strata-macos-cert.p12')
        && (step.run ?? '').includes('AuthKey.p8'),
    )
    expect(cleanupStep).toBeDefined()
  })
})

function validateWorkflowSecurity(filename: string, doc: WorkflowDoc): readonly string[] {
  const violations: string[] = []
  const forbiddenRunInterpolation = /\$\{\{\s*(?:inputs|github\.event\.inputs|secrets)\./u

  if (doc.permissions?.contents !== 'read' || Object.keys(doc.permissions ?? {}).length !== 1) {
    violations.push(`${filename}: top-level permissions must be strictly { contents: 'read' }`)
  }

  for (const [jobId, job] of Object.entries(doc.jobs)) {
    const jobPerms = job.permissions ?? {}
    for (const [scope, level] of Object.entries(jobPerms)) {
      if (level === 'write') {
        const allowedPublishWrite =
          filename === 'strata-release.yml' && jobId === 'publish' && (scope === 'contents' || scope === 'actions')
        const allowedRadarWrite = filename === 'strata-upstream-watch.yml' && jobId === 'radar' && scope === 'issues'
        if (!allowedPublishWrite && !allowedRadarWrite) {
          violations.push(`${filename}#${jobId}: unexpected write permission ${scope}: write`)
        }
      }
    }

    for (const step of job.steps ?? []) {
      if (typeof step.run === 'string' && forbiddenRunInterpolation.test(step.run)) {
        violations.push(`${filename}#${jobId} (${step.name ?? 'unnamed'}): direct inputs/secrets interpolation in run:`)
      }
    }
  }

  return violations
}

describe('StrataHarness atomic release orchestrator & cross-workflow security contracts', () => {
  it('orchestrates preflight, parallel Windows+macOS packaging, atomic 3-target publish gate, update-feed artifact, gh release, and two-phase S3 sync', () => {
    const { doc } = loadWorkflowYaml('strata-release.yml')

    expect(doc.permissions).toEqual({ contents: 'read' })

    const pushTrigger = doc.on.push as { tags?: readonly string[] } | undefined
    expect(pushTrigger?.tags).toEqual(['strata-v*'])
    expect(doc.on).toHaveProperty('workflow_dispatch')

    const preflightJob = doc.jobs.preflight
    expect(preflightJob?.['runs-on']).toBe('ubuntu-24.04')
    expect(preflightJob?.permissions).toEqual({ contents: 'read' })
    const preflightRuns = (preflightJob?.steps ?? []).map(step => step.run ?? '').join('\n')
    expect(preflightRuns).toContain('pnpm run strata:audit-overrides')
    expect(preflightRuns).toContain('scripts/strata/release-helper.ts preflight')

    const winJob = doc.jobs['package-windows']
    expect(winJob?.uses).toBe('./.github/workflows/strata-windows-package.yml')
    expect(winJob?.permissions).toEqual({ contents: 'read' })
    expect(winJob?.if).toContain("needs.preflight.outputs.run_windows == 'true'")

    const macJob = doc.jobs['package-macos']
    expect(macJob?.uses).toBe('./.github/workflows/strata-macos-package.yml')
    expect(macJob?.permissions).toEqual({ contents: 'read' })
    expect(macJob?.if).toContain("needs.preflight.outputs.run_macos == 'true'")

    const publishJob = doc.jobs.publish
    expect(publishJob?.['runs-on']).toBe('ubuntu-24.04')
    expect(publishJob?.permissions).toEqual({ contents: 'write', actions: 'write' })
    expect(publishJob?.needs).toEqual(['preflight', 'package-windows', 'package-macos'])
    expect(publishJob?.if).toContain("needs.preflight.result == 'success'")
    expect(publishJob?.if).toContain("needs.package-windows.result == 'success'")
    expect(publishJob?.if).toContain("needs.package-macos.result == 'success'")

    const publishSteps = publishJob?.steps ?? []
    const downloadStep = publishSteps.find(step => step.uses === 'actions/download-artifact@v8.0.1')
    expect(downloadStep?.with?.pattern).toBe('strata-dist-*')

    const feedArtifactStep = publishSteps.find(
      step => step.uses === 'actions/upload-artifact@v7.0.1' && step.with?.name === 'update-feed',
    )
    expect(feedArtifactStep).toBeDefined()

    const publishRuns = publishSteps.map(step => step.run ?? '').join('\n')
    expect(publishRuns).toContain('scripts/strata/release-helper.ts collect')
    expect(publishRuns).toContain('gh release')
    expect(publishRuns).toContain('RELEASE_NOTES.md')
    expect(publishRuns).toContain('SHA256SUMS.txt')

    const releaseStepIndex = publishSteps.findIndex(step => (step.run ?? '').includes('gh release create'))
    const cleanupArtifactsStepIndex = publishSteps.findIndex(
      step => (step.run ?? '').includes('gh api -X DELETE') && (step.run ?? '').includes('strata-dist-'),
    )
    expect(releaseStepIndex).toBeGreaterThan(-1)
    expect(cleanupArtifactsStepIndex).toBeGreaterThan(releaseStepIndex)
    const cleanupArtifactsStep = publishSteps[cleanupArtifactsStepIndex]
    expect(cleanupArtifactsStep?.if).toBe('success()')
    expect(cleanupArtifactsStep?.['continue-on-error']).toBe(true)
    expect(cleanupArtifactsStep?.run).toContain('strata-packaging-runs-')
    expect(cleanupArtifactsStep?.run).toContain('gh api --paginate')
    expect(cleanupArtifactsStep?.run).toContain('::warning::Could not list temporary artifacts')

    const s3Step = publishSteps.find(step => (step.run ?? '').includes('aws s3 sync'))
    expect(s3Step).toBeDefined()
    const s3Run = s3Step?.run ?? ''
    const excludeYmlIndex = s3Run.indexOf('--exclude "*.yml"')
    const includeYmlIndex = s3Run.indexOf('--include "*.yml"')
    expect(excludeYmlIndex).toBeGreaterThan(-1)
    expect(includeYmlIndex).toBeGreaterThan(excludeYmlIndex)

    // Multi-target subset choices, release_tag publish concurrency lock, and atomic upload-then-prune-then-edit order.
    const dispatchInputs = (doc.on.workflow_dispatch as { inputs?: Record<string, { options?: readonly string[] }> } | undefined)?.inputs
    expect(dispatchInputs?.targets?.options).toEqual([
      'all',
      'win-x64',
      'mac-arm64',
      'mac-x64',
      'mac-arm64,mac-x64',
      'win-x64,mac-arm64',
      'win-x64,mac-x64',
    ])
    expect(publishJob?.concurrency).toEqual({
      group: 'strata-release-publish-${{ needs.preflight.outputs.release_tag }}',
      'cancel-in-progress': false,
    })

    const releaseStepRun = publishSteps.find(step => (step.run ?? '').includes('gh release create'))?.run ?? ''
    const uploadIdx = releaseStepRun.indexOf('gh release upload')
    const pruneIdx = releaseStepRun.indexOf('gh release delete-asset')
    const editIdx = releaseStepRun.indexOf('gh release edit')
    expect(uploadIdx).toBeGreaterThan(-1)
    expect(pruneIdx).toBeGreaterThan(uploadIdx)
    expect(editIdx).toBeGreaterThan(pruneIdx)

    // Forced unsigned runs skip secret materialization; macOS normalizes signing identity prefix and writes 0o600 files.
    const winRaw = loadWorkflowYaml('strata-windows-package.yml').raw
    const macRaw = loadWorkflowYaml('strata-macos-package.yml').raw
    expect(winRaw).toContain("$requestedMode -ne 'unsigned'")
    expect(macRaw).toContain('requestedMode !== "unsigned"')
    expect(macRaw).toContain('mode: 0o600')
    expect(macRaw).toContain('replace(/^Developer ID Application:\\s*/iu, "")')
  })

  it('enforces .github/workflows/ isolation, zero script injection in run: blocks, least-privilege permissions, and rejects invalid cases', () => {
    const workflowFiles = readdirSync(resolve(REPO_ROOT, '.github/workflows'))
      .filter(name => name.endsWith('.yml') || name.endsWith('.yaml'))
      .sort()

    expect(workflowFiles).toEqual([
      'strata-macos-package.yml',
      'strata-release.yml',
      'strata-upstream-watch.yml',
      'strata-windows-package.yml',
    ])

    const audit = auditForkOverrides(REPO_ROOT)
    expect(audit.violations).toEqual([])
    expect(audit.ok).toBe(true)

    for (const filename of workflowFiles) {
      const { doc } = loadWorkflowYaml(filename)
      expect(validateWorkflowSecurity(filename, doc)).toEqual([])
    }

    const unsafeSyntheticWorkflow: WorkflowDoc = {
      name: 'Unsafe Synthetic',
      on: { workflow_dispatch: {} },
      permissions: { contents: 'read' },
      jobs: {
        package: {
          permissions: { contents: 'write', actions: 'write' },
          steps: [{ name: 'Injected', run: 'echo ${{ inputs.signing_mode }}' }],
        },
      },
    }
    expect(validateWorkflowSecurity('strata-windows-package.yml', unsafeSyntheticWorkflow)).toEqual([
      'strata-windows-package.yml#package: unexpected write permission contents: write',
      'strata-windows-package.yml#package: unexpected write permission actions: write',
      'strata-windows-package.yml#package (Injected): direct inputs/secrets interpolation in run:',
    ])

    const repoRoot = createReleaseRepoFixture()
    const poisonedDir = join(repoRoot, 'poisoned-unsigned')
    writeText(poisonedDir, 'strata-dist-win-x64/strataharness-1.0.0-win-x64-unsigned.exe', 'unsigned-exe')
    writeText(poisonedDir, 'strata-dist-win-x64/latest.yml', 'version: 1.0.0\n')
    expect(() =>
      collectReleaseArtifacts({
        repoRoot,
        artifactsDir: poisonedDir,
        outDir: join(repoRoot, 'poisoned-out'),
        targets: 'win-x64',
        draft: true,
      }),
    ).toThrow(/must not carry auto-update metadata/u)
  })
})
