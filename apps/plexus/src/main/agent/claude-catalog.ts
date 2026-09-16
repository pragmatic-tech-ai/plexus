// Pure scanner for a project's declared .claude/ capabilities. Behind a small IO
// seam (exists/readDir/readFile) so it unit-tests without a real filesystem; the
// provider injects a node:fs-backed impl.
import { AgentSkillKind, type CatalogItem, type ProjectCatalog } from '../../shared/agent-api.js'

export interface CatalogIo
{
    exists(path: string): Promise<boolean>
    readDir(path: string): Promise<string[]>
    readFile(path: string): Promise<string>
}

// Read `name` / `description` from a leading `--- … ---` YAML fence. Deliberately
// minimal (no YAML dep): only these two scalar keys, first fence only.
export function parseFrontMatter(text: string): { name?: string; description?: string }
{
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
    if (match === null) return {}
    const out: { name?: string; description?: string } = {}
    for (const line of match[1].split(/\r?\n/))
    {
        const kv = /^(name|description)\s*:\s*(.*)$/.exec(line.trim())
        if (kv === null) continue
        const value = kv[2].replace(/^["']|["']$/g, '').trim()
        if (kv[1] === 'name') out.name = value
        else out.description = value
    }
    return out
}

// Join with a forward slash (main runs on the scanned host; node:fs accepts '/').
function join(a: string, b: string): string { return a.endsWith('/') ? a + b : `${a}/${b}` }

async function readAgents(dir: string, io: CatalogIo): Promise<CatalogItem[]>
{
    if (!(await io.exists(dir))) return []
    const items: CatalogItem[] = []
    for (const entry of await io.readDir(dir))
    {
        if (!entry.endsWith('.md')) continue
        const fm = parseFrontMatter(await io.readFile(join(dir, entry)))
        items.push({ kind: AgentSkillKind.Agent, name: fm.name ?? entry.replace(/\.md$/, ''), description: fm.description ?? '' })
    }
    return items
}

async function readSkills(dir: string, io: CatalogIo): Promise<CatalogItem[]>
{
    if (!(await io.exists(dir))) return []
    const items: CatalogItem[] = []
    for (const name of await io.readDir(dir))
    {
        const skillFile = join(join(dir, name), 'SKILL.md')
        if (!(await io.exists(skillFile))) continue
        const fm = parseFrontMatter(await io.readFile(skillFile))
        items.push({ kind: AgentSkillKind.Skill, name: fm.name ?? name, description: fm.description ?? '' })
    }
    return items
}

export async function scanClaudeCatalog(projectDir: string, io: CatalogIo): Promise<ProjectCatalog>
{
    // No `.claude` existence gate — readAgents/readSkills each guard on their own
    // subdir, so a project without `.claude/agents` or `.claude/skills` yields [].
    const claude = join(projectDir, '.claude')
    const agents = await readAgents(join(claude, 'agents'), io)
    const skills = await readSkills(join(claude, 'skills'), io)
    return { agents, skills }
}
