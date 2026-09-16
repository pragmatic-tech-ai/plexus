import { describe, it, expect } from 'vitest'
import { SkillScaffolder, SkillTemplateKind } from '../skill-scaffolder.js'
import { SkillFileCodec } from '../skill-file-codec.js'
import { SkillScope } from '../../../../../../shared/skill-api.js'

class FakeFs {
    files = new Map<string, string>(); dirs = new Set<string>()
    async exists(p: string): Promise<boolean> { return this.files.has(p) || this.dirs.has(p) }
    async createDirectory(p: string): Promise<void> { this.dirs.add(p) }
    async writeText(p: string, c: string): Promise<void> { this.files.set(p, c) }
}

describe('SkillScaffolder', () => {
    const roots = { projectDir: '/proj', homeDir: '/home/u' }

    it('writes a Blank template into project scope and returns the folder', async () => {
        const fs = new FakeFs()
        const s = new SkillScaffolder(fs, roots)
        const folder = await s.create({ name: 'My Skill', description: 'Does a thing.',
            scope: SkillScope.Project, template: SkillTemplateKind.Blank })
        expect(folder).toBe('/proj/.claude/skills/my-skill')
        const md = fs.files.get('/proj/.claude/skills/my-skill/SKILL.md')!
        expect(md).toContain('name: my-skill')
        expect(md).not.toMatch(/x-plexus/)
    })

    it('writes a Superset template into global scope with a valid x-plexus block', async () => {
        const fs = new FakeFs()
        const s = new SkillScaffolder(fs, roots)
        const folder = await s.create({ name: 'C4 View', description: 'C4.',
            scope: SkillScope.Global, template: SkillTemplateKind.Superset })
        expect(folder).toBe('/home/u/.claude/skills/c4-view')
        const md = fs.files.get('/home/u/.claude/skills/c4-view/SKILL.md')!
        const x = new SkillFileCodec().readExtension(md)
        expect(x.version).toBe(1)
        expect(x.inputs[0].key).toBe('viewpoint')
    })

    it('rejects when the folder already exists', async () => {
        const fs = new FakeFs(); fs.dirs.add('/proj/.claude/skills/dup')
        const s = new SkillScaffolder(fs, roots)
        await expect(s.create({ name: 'dup', description: '', scope: SkillScope.Project,
            template: SkillTemplateKind.Blank })).rejects.toThrow(/exists/i)
    })
})
