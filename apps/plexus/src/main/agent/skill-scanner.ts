import { join } from 'node:path'
import { AgentSkillKind } from '../../shared/agent-api.js'
import type { CatalogIo } from './claude-catalog.js'
import type { ScopeRoot } from './skill-scope-resolver.js'
import { SkillScopeResolver } from './skill-scope-resolver.js'
import { SkillFrontmatterParser } from './skill-frontmatter-parser.js'
import type { SkillDescriptor } from '../../shared/skill-api.js'

// Walks every scope root and parses each SKILL.md into a SkillDescriptor. Flat,
// scope-tagged output; precedence dedupe is the renderer catalog's job (spec §5.1).
export class SkillScanner
{
    private readonly resolver: SkillScopeResolver
    private readonly parser: SkillFrontmatterParser
    private readonly io: CatalogIo

    constructor(resolver: SkillScopeResolver, parser: SkillFrontmatterParser, io: CatalogIo)
    {
        this.resolver = resolver
        this.parser = parser
        this.io = io
    }

    async scan(projectDir: string): Promise<SkillDescriptor[]>
    {
        const out: SkillDescriptor[] = []
        for (const root of this.resolver.rootsFor(projectDir))
        {
            if (root.nested) out.push(...await this.scanPackaged(root))
            else out.push(...await this.scanFlat(root.skillsDir, root))
        }
        return out
    }

    // A flat skills dir: <skillsDir>/<name>/SKILL.md.
    private async scanFlat(skillsDir: string, root: ScopeRoot): Promise<SkillDescriptor[]>
    {
        if (!(await this.io.exists(skillsDir))) return []
        const out: SkillDescriptor[] = []
        for (const name of await this.io.readDir(skillsDir))
        {
            const folder = join(skillsDir, name)
            const file = join(folder, 'SKILL.md')
            if (!(await this.io.exists(file))) continue
            out.push(this.parser.parse(await this.io.readFile(file), { kind: AgentSkillKind.Skill, fallbackName: name, scope: root.scope, folderPath: folder }))
        }
        return out
    }

    // A package backend: <backend>/<id>/<version>/skills/<name>/SKILL.md.
    private async scanPackaged(root: ScopeRoot): Promise<SkillDescriptor[]>
    {
        if (!(await this.io.exists(root.skillsDir))) return []
        const out: SkillDescriptor[] = []
        for (const id of await this.io.readDir(root.skillsDir))
        {
            const idDir = join(root.skillsDir, id)
            for (const version of await this.io.readDir(idDir))
            {
                const skillsDir = join(idDir, version, 'skills')
                out.push(...await this.scanFlat(skillsDir, root))
            }
        }
        return out
    }
}
