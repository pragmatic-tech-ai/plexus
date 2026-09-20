import { test, expect } from 'vitest'
import { SkillAuthoringService, type AuthoringDeps } from '../skill-authoring-service.js'
import { Skill } from '../skill.js'
import { SkillDescriptorFactory, SkillScope, type SkillDescriptor } from '../../../../../../shared/skill-api.js'
import { SkillTemplateKind, type NewSkillRequest } from '../skill-scaffolder.js'
import { AgentSkillKind } from '../../../../../../shared/agent-api.js'

class FakeBuffer
{
    saved = 0
    constructor(public Content: string) {}
    async Save(): Promise<void> { this.saved++ }
}
const FILE = `---\nname: demo\ndescription: d\n---\n\nbody\n`

function skillAt(folder: string, scope: SkillScope = SkillScope.Project, name = 'demo', origin?: string): Skill
{
    const d: SkillDescriptor = SkillDescriptorFactory.claudeCode(AgentSkillKind.Skill, name, 'd', scope, folder)
    return new Skill(d, origin)
}

function service(over: Partial<AuthoringDeps>, catalog: Skill[]): SkillAuthoringService
{
    const full: AuthoringDeps = {
        skills: () => catalog,
        openProjectDirs: () => [],
        discover: async () => {},
        openBuffer: () => new FakeBuffer(FILE),
        presentNewSkillDialog: async () => undefined,
        scaffold: async () => { throw new Error('scaffold should not be called') },
        run: async () => {},
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

test('RunCommand is disabled until a skill is selected', () => {
    const s = service({ openProjectDirs: () => ['/a'] }, [skillAt('/a/.claude/skills/demo', SkillScope.Project, 'demo', '/a')])
    expect(s.RunCommand.CanExecute(undefined)).toBe(false)
    s.Select(s.Skills[0])
    expect(s.RunCommand.CanExecute(undefined)).toBe(true)
})

test('Run runs a project skill against its origin project', async () => {
    let ran: { name: string; dir: string; proj: string } | undefined
    const skill = skillAt('/b/.claude/skills/demo', SkillScope.Project, 'demo', '/b')
    const s = service({
        openProjectDirs: () => ['/a', '/b'],
        run: async (sk, dir, name) => { ran = { name: sk.Name, dir, proj: name } },
    }, [skill])
    s.Select(s.Skills[0])
    await s.Run()
    expect(ran).toEqual({ name: 'demo', dir: '/b', proj: 'b' })
})

test('Run runs a global skill against the active (first open) project', async () => {
    let dir: string | undefined
    const skill = skillAt('/glob/demo', SkillScope.Global, 'demo')
    const s = service({ openProjectDirs: () => ['/a', '/b'], run: async (_s, d) => { dir = d } }, [skill])
    s.Select(s.Skills[0])
    await s.Run()
    expect(dir).toBe('/a')
})

test('RunCommand stays disabled for a global skill with no project open', () => {
    const s = service({ openProjectDirs: () => [] }, [skillAt('/glob/demo', SkillScope.Global, 'demo')])
    s.Select(s.Skills[0])
    expect(s.RunCommand.CanExecute(undefined)).toBe(false)
})

test('Groups sections skills by open project in order, then Global then Packaged', () => {
    const a = skillAt('/a/.claude/skills/one', SkillScope.Project, 'one', '/a')
    const b = skillAt('/b/.claude/skills/two', SkillScope.Project, 'two', '/b')
    const g = skillAt('/glob/three', SkillScope.Global, 'three')
    const p = skillAt('/pkg/x/1/skills/four', SkillScope.Packaged, 'four')
    const s = service({ openProjectDirs: () => ['/a', '/b'] }, [a, b, g, p])
    expect(s.Groups.map(x => x.Header)).toEqual(['a', 'b', 'Global', 'Packaged'])
    expect(s.Groups[0].Items).toHaveLength(1)
})

test('Groups shows both same-name project skills under their own project', () => {
    const a = skillAt('/a/.claude/skills/review', SkillScope.Project, 'review', '/a')
    const b = skillAt('/b/.claude/skills/review', SkillScope.Project, 'review', '/b')
    const s = service({ openProjectDirs: () => ['/a', '/b'] }, [a, b])
    expect(s.Groups.map(x => x.Header)).toEqual(['a', 'b'])
})

test('Groups omits empty sections', () => {
    const g = skillAt('/glob/only', SkillScope.Global, 'only')
    const s = service({ openProjectDirs: () => ['/a'] }, [g])
    expect(s.Groups.map(x => x.Header)).toEqual(['Global'])
})

test('New scaffolds into the project chosen in the dialog', async () => {
    const req: NewSkillRequest = { name: 'Fresh', description: '', scope: SkillScope.Project, template: SkillTemplateKind.Blank, projectDir: '/b' }
    let scaffolded: NewSkillRequest | undefined
    const s = service({
        presentNewSkillDialog: async () => req,
        scaffold: async (r) => { scaffolded = r; return '/b/.claude/skills/fresh' },
        discover: async () => {},
    }, [])
    await s.New()
    expect(scaffolded!.projectDir).toBe('/b')
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
