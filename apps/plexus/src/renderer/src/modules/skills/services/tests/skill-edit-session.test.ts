import { describe, it, expect } from 'vitest'
import { SkillEditSession } from '../skill-edit-session.js'
import { SkillFileCodec } from '../skill-file-codec.js'
import { SkillValidator } from '../skill-validator.js'
import { Skill } from '../skill.js'
import { SkillDescriptorFactory, SkillScope } from '../../../../../../shared/skill-api.js'
import { AgentSkillKind } from '../../../../../../shared/agent-api.js'

class FakeBuffer
{
    saved = 0
    constructor(public Content: string) {}
    async Save(): Promise<void> { this.saved++ }
}

const skill = (scope: SkillScope): Skill => new Skill(
    SkillDescriptorFactory.claudeCode(AgentSkillKind.Skill, 'demo', 'd', scope, '/proj/.claude/skills/demo'))
const FILE = `---\nname: demo\ndescription: d\n---\n\n# Demo\nbody\n`

describe('SkillEditSession', () => {
    it('seeds the form from the buffer content', () => {
        const buf = new FakeBuffer(FILE)
        const s = new SkillEditSession(skill(SkillScope.Project), buf, new SkillFileCodec(), new SkillValidator())
        expect(s.Form.Title).toBe('')
        expect(s.IsReadOnly).toBe(false)
    })

    it('applies a form edit into only the x-plexus region of the buffer', () => {
        const buf = new FakeBuffer(FILE)
        const s = new SkillEditSession(skill(SkillScope.Project), buf, new SkillFileCodec(), new SkillValidator())
        s.Form.Title = 'Demo Title'
        expect(buf.Content).toContain('name: demo')
        expect(buf.Content).toContain('body')
        expect(buf.Content).toMatch(/x-plexus/)
        expect(buf.Content).toContain('Demo Title')
    })

    it('save delegates to the buffer', async () => {
        const buf = new FakeBuffer(FILE)
        const s = new SkillEditSession(skill(SkillScope.Project), buf, new SkillFileCodec(), new SkillValidator())
        await s.save()
        expect(buf.saved).toBe(1)
    })

    it('is read-only for packaged scope', () => {
        const buf = new FakeBuffer(FILE)
        const s = new SkillEditSession(skill(SkillScope.Packaged), buf, new SkillFileCodec(), new SkillValidator())
        expect(s.IsReadOnly).toBe(true)
        s.Form.Title = 'nope'
        expect(buf.Content).toBe(FILE)
    })
})
