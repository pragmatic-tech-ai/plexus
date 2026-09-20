import { test, expect } from 'vitest'
import { Skill } from '../skill.js'
import { AgentSkillKind } from '../../../../../../shared/agent-api.js'
import { SkillScope, SkillSourceKind, ProjectType, SkillProblemSeverity, type SkillDescriptor } from '../../../../../../shared/skill-api.js'

function desc(over: Partial<SkillDescriptor> = {}): SkillDescriptor
{
    return {
        kind: AgentSkillKind.Skill, name: 'n', title: 'Title', description: 'd',
        scope: SkillScope.Project, sourceKind: SkillSourceKind.PlexusSuperset,
        tags: ['x'], requiresProjectType: [], allowedTools: [],
        inputs: [], bindings: [], outputs: [], problems: [], folderPath: '/p', ...over,
    }
}

test('exposes typed metadata', () => {
    const s = new Skill(desc({ category: 'Diagrams' }))
    expect(s.Title).toBe('Title')
    expect(s.Category).toBe('Diagrams')
    expect(s.IsPlexusSuperset).toBe(true)
    expect(s.HasInputs).toBe(false)
})

test('appliesToProjectType: empty gate matches everything', () => {
    expect(new Skill(desc()).appliesToProjectType(ProjectType.Library)).toBe(true)
})

test('appliesToProjectType: gate restricts to listed types', () => {
    const s = new Skill(desc({ requiresProjectType: [ProjectType.Architecture] }))
    expect(s.appliesToProjectType(ProjectType.Architecture)).toBe(true)
    expect(s.appliesToProjectType(ProjectType.Library)).toBe(false)
})

test('origin project: path + basename for a project skill, undefined off a project scope', () => {
    const p = new Skill(desc(), 'C:/work/my-proj')
    expect(p.IsProjectScoped).toBe(true)
    expect(p.OriginProjectPath).toBe('C:/work/my-proj')
    expect(p.OriginProjectName).toBe('my-proj')
    expect(new Skill(desc(), 'D:\\a\\proj\\').OriginProjectName).toBe('proj')

    const g = new Skill(desc({ scope: SkillScope.Global }))
    expect(g.IsProjectScoped).toBe(false)
    expect(g.OriginProjectPath).toBeUndefined()
    expect(g.OriginProjectName).toBeUndefined()
})

test('deprecation + problems flags', () => {
    const s = new Skill(desc({ deprecation: { note: 'old' }, problems: [{ message: 'm', severity: SkillProblemSeverity.Warning }] }))
    expect(s.IsDeprecated).toBe(true)
    expect(s.DeprecationNote).toBe('old')
    expect(s.HasProblems).toBe(true)
})
