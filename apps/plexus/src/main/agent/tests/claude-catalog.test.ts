import { test, expect } from 'vitest'
import { scanClaudeCatalog, parseFrontMatter, type CatalogIo } from '../claude-catalog.js'
import { AgentSkillKind } from '../../../shared/agent-api.js'

// An in-memory filesystem: dirs → child names, files → contents.
function fakeIo(files: Record<string, string>, dirs: Record<string, string[]>): CatalogIo {
    return {
        exists: (p) => Promise.resolve(p in files || p in dirs),
        readDir: (p) => Promise.resolve(dirs[p] ?? []),
        readFile: (p) => Promise.resolve(files[p] ?? ''),
    }
}

const AGENT_MD = `---
name: reviewer
description: Reviews changes for bugs
---
You are a careful reviewer.`

const SKILL_MD = `---
name: security-review
description: Audits for security issues
---
Do a security review.`

test('parseFrontMatter reads name + description from the YAML fence', () => {
    expect(parseFrontMatter(AGENT_MD)).toEqual({ name: 'reviewer', description: 'Reviews changes for bugs' })
})

test('parseFrontMatter tolerates a file with no front-matter', () => {
    expect(parseFrontMatter('just prose, no fence')).toEqual({})
})

test('scan reads agents and skills with parsed metadata', async () => {
    const io = fakeIo(
        {
            '/p/.claude/agents/reviewer.md': AGENT_MD,
            '/p/.claude/skills/security-review/SKILL.md': SKILL_MD,
        },
        {
            '/p/.claude/agents': ['reviewer.md', 'notes.txt'],   // non-.md ignored
            '/p/.claude/skills': ['security-review'],
        },
    )
    const catalog = await scanClaudeCatalog('/p', io)
    expect(catalog.agents).toEqual([{ kind: AgentSkillKind.Agent, name: 'reviewer', description: 'Reviews changes for bugs' }])
    expect(catalog.skills).toEqual([{ kind: AgentSkillKind.Skill, name: 'security-review', description: 'Audits for security issues' }])
})

test('a missing .claude directory yields an empty catalog', async () => {
    const catalog = await scanClaudeCatalog('/p', fakeIo({}, {}))
    expect(catalog).toEqual({ agents: [], skills: [] })
})

test('an agent md with no name falls back to its file basename', async () => {
    const io = fakeIo(
        { '/p/.claude/agents/planner.md': 'no front matter here' },
        { '/p/.claude/agents': ['planner.md'] },
    )
    const catalog = await scanClaudeCatalog('/p', io)
    expect(catalog.agents).toEqual([{ kind: AgentSkillKind.Agent, name: 'planner', description: '' }])
})
