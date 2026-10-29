/**
 * Keep Claude Code and Codex invocation metadata aligned for repository skills.
 * @module scripts/verify-skill-invocation-metadata
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { load } from 'js-yaml'

const ROOT = resolve(import.meta.dirname, '..')

/** Return an object-shaped YAML value, or undefined for every other shape. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Parse a skill's YAML frontmatter as an object. */
function parseSkillFrontmatter(source: string): Record<string, unknown> {
  const lines = source.split('\n')
  if (lines[0] !== '---') throw new Error('SKILL.md must start with YAML frontmatter')
  const end = lines.indexOf('---', 1)
  if (end < 0) throw new Error('SKILL.md frontmatter is not closed')
  const metadata = asRecord(load(lines.slice(1, end).join('\n')))
  if (metadata === undefined) throw new Error('SKILL.md frontmatter must be a YAML object')
  return metadata
}

/** Find all repository skill directories under `.agents/skills`. */
function allSkillDirectories(root: string): string[] {
  const skillsRoot = resolve(root, '.agents/skills')
  if (!existsSync(skillsRoot)) return []
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
}

/** Extract skill directory names registered in `.agents/SKILLS.md` table rows. */
function registeredSkills(registrySource: string): string[] {
  const names: string[] = []
  for (const match of registrySource.matchAll(/^\|\s*\[[^\]]+\]\(skills\/([^/)\s]+)\/SKILL\.md\)/gm)) {
    const name = match[1]
    if (name !== undefined) names.push(name)
  }
  return names
}

/**
 * Report cross-product invocation-policy and skill-registry mismatches for repository skills.
 * @param root - Repository root containing `.agents/skills` and optional `.agents/SKILLS.md`.
 * @returns diagnostics for malformed metadata, unregistered skills, or divergent invocation policies.
 */
export function collectSkillInvocationMetadataViolations(root: string): string[] {
  const violations: string[] = []
  const skills = allSkillDirectories(root)

  const registryFile = resolve(root, '.agents/SKILLS.md')
  if (existsSync(registryFile)) {
    const listed = registeredSkills(readFileSync(registryFile, 'utf8'))
    const counts = new Map<string, number>()
    for (const name of listed) counts.set(name, (counts.get(name) ?? 0) + 1)
    for (const [name, count] of [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (count > 1) violations.push(`.agents/SKILLS.md: skill '${name}' is listed ${String(count)} times`)
      if (!skills.includes(name)) violations.push(`.agents/SKILLS.md: registered skill '${name}' has no .agents/skills/${name} directory`)
    }
    for (const skill of skills) {
      if (!counts.has(skill)) violations.push(`.agents/skills/${skill}: missing from .agents/SKILLS.md`)
    }
  }

  for (const skill of skills) {
    const relativeRoot = `.agents/skills/${skill}`
    const skillFile = resolve(root, relativeRoot, 'SKILL.md')
    const openaiFile = resolve(root, relativeRoot, 'agents/openai.yaml')
    const hasOpenaiFile = existsSync(openaiFile)
    if (!existsSync(skillFile)) {
      violations.push(
        hasOpenaiFile
          ? `${relativeRoot}: agents/openai.yaml has no sibling SKILL.md`
          : `${relativeRoot}: skill directory has no SKILL.md`,
      )
      continue
    }

    let frontmatter: Record<string, unknown>
    try {
      frontmatter = parseSkillFrontmatter(readFileSync(skillFile, 'utf8'))
    }
    catch (error) {
      violations.push(`${relativeRoot}/SKILL.md: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }

    if (frontmatter.name !== skill) {
      violations.push(`${relativeRoot}/SKILL.md: frontmatter name '${String(frontmatter.name)}' must match directory '${skill}'`)
    }

    const disableModelInvocation = frontmatter['disable-model-invocation']
    if (disableModelInvocation !== undefined && typeof disableModelInvocation !== 'boolean') {
      violations.push(`${relativeRoot}/SKILL.md: disable-model-invocation must be a boolean`)
      continue
    }
    const userInvocable = frontmatter['user-invocable']
    if (userInvocable !== undefined && typeof userInvocable !== 'boolean') {
      violations.push(`${relativeRoot}/SKILL.md: user-invocable must be a boolean`)
      continue
    }

    const claudeManualOnly = disableModelInvocation === true
    if (claudeManualOnly && userInvocable === false) {
      violations.push(`${relativeRoot}/SKILL.md: a manual-only skill must remain user-invocable`)
    }

    if (!hasOpenaiFile) {
      if (claudeManualOnly) {
        violations.push(`${relativeRoot}: Claude Code manual-only=true requires agents/openai.yaml with policy.allow_implicit_invocation=false`)
      }
      continue
    }

    let openai: Record<string, unknown>
    try {
      const parsed = asRecord(load(readFileSync(openaiFile, 'utf8')))
      if (parsed === undefined) throw new Error('agents/openai.yaml must be a YAML object')
      openai = parsed
    }
    catch (error) {
      violations.push(`${relativeRoot}/agents/openai.yaml: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }

    const policy = asRecord(openai.policy)
    const allowImplicitInvocation = policy?.allow_implicit_invocation
    if (allowImplicitInvocation !== undefined && typeof allowImplicitInvocation !== 'boolean') {
      violations.push(`${relativeRoot}/agents/openai.yaml: policy.allow_implicit_invocation must be a boolean`)
      continue
    }

    const codexManualOnly = allowImplicitInvocation === false
    if (claudeManualOnly !== codexManualOnly) {
      violations.push(
        `${relativeRoot}: Claude Code manual-only=${String(claudeManualOnly)}`
        + ` but Codex manual-only=${String(codexManualOnly)}`,
      )
    }
  }

  return violations
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const skills = allSkillDirectories(ROOT)
  const violations = collectSkillInvocationMetadataViolations(ROOT)
  if (violations.length > 0) {
    process.stderr.write('verify-skill-invocation-metadata: violations found:\n')
    for (const violation of violations) process.stderr.write(`  ${violation}\n`)
    process.exit(1)
  }

  process.stdout.write(
    `verify-skill-invocation-metadata: ${String(skills.length)} skill(s) verified.\n`,
  )
}
