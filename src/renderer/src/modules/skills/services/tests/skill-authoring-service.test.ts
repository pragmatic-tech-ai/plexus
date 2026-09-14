import { test, expect } from 'vitest'
import { SkillAuthoringService, type AuthoringDeps } from '../skill-authoring-service.js'
import { Skill } from '../skill.js'
import { SkillDescriptorFactory, SkillScope, type SkillDescriptor } from '../../../../../../shared/skill-api.js'
import { SkillTemplateKind, type NewSkillRequest } from '../skill-scaffolder.js'
import { AgentSkillKind } from '../../../../../../shared/agent-api.js'

class FakeBuffer {
    saved = 0
    constructor(public Content: string) {}
    async Save(): Promise<void> { this.saved++ }
}
const FILE = `---\nname: demo\ndescription: d\n---\n\nbody\n`

function skillAt(folder: string, scope: SkillScope = SkillScope.Project): Skill {
    const d: SkillDescriptor = SkillDescriptorFactory.claudeCode(AgentSkillKind.Skill, 'demo', 'd', scope, folder)
    return new Skill(d)
}

function service(over: Partial<AuthoringDeps>, catalog: Skill[]): SkillAuthoringService {
    const full: AuthoringDeps = {
        skills: () => catalog,
        discover: async () => {},
        openBuffer: () => new FakeBuffer(FILE),
        presentNewSkillDialog: async () => undefined,
        scaffold: async () => { throw new Error('scaffold should not be called') },
        ...over,
    }
    return new SkillAuthoringService(undefined as never, full)
}

test('Select builds a session bound to the skill', () => {
    const s = service({}, [skillAt('/proj/.claude/skills/demo')])
    s.Select(s.Skills[0])
    expect(s.Session).toBeDefined()
    expect(s.Session!.IsReadOnly).toBe(false)
})

test('SaveCommand is disabled with no session and enabled after selecting a writable skill', () => {
    const s = service({}, [skillAt('/proj/.claude/skills/demo')])
    expect(s.SaveCommand.CanExecute(undefined)).toBe(false)
    s.Select(s.Skills[0])
    expect(s.SaveCommand.CanExecute(undefined)).toBe(true)
})

test('SaveCommand stays disabled for a packaged (read-only) skill', () => {
    const s = service({}, [skillAt('/pkg/x/1/skills/demo', SkillScope.Packaged)])
    s.Select(s.Skills[0])
    expect(s.SaveCommand.CanExecute(undefined)).toBe(false)
})

test('NewCommand scaffolds, refreshes, and selects the created skill', async () => {
    const catalog: Skill[] = []
    const req: NewSkillRequest = { name: 'Fresh', description: '', scope: SkillScope.Project, template: SkillTemplateKind.Blank }
    const created = skillAt('/proj/.claude/skills/fresh')
    let scaffolded: NewSkillRequest | undefined
    const s = service({
        presentNewSkillDialog: async () => req,
        scaffold: async (r) => { scaffolded = r; return '/proj/.claude/skills/fresh' },
        discover: async () => { catalog.push(created) },
    }, catalog)
    await s.New()
    expect(scaffolded).toEqual(req)
    expect(s.Session).toBeDefined()
    expect(s.Session!.Form).toBeDefined()
})
