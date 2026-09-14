import { test, expect } from 'vitest'
import { SkillCatalog } from '../skill-catalog.js'
import { AgentSkillKind } from '../../../../../../shared/agent-api.js'
import { SkillScope, SkillSourceKind, ProjectType, type SkillDescriptor } from '../../../../../../shared/skill-api.js'

function d(name: string, scope: SkillScope, over: Partial<SkillDescriptor> = {}): SkillDescriptor {
    return {
        kind: AgentSkillKind.Skill, name, title: name, description: '', scope,
        sourceKind: SkillSourceKind.ClaudeCode, tags: [], requiresProjectType: [], allowedTools: [],
        inputs: [], bindings: [], outputs: [], problems: [], folderPath: `/${scope}/${name}`, ...over,
    }
}

// SkillCatalog takes an injected loader so the test needs no window.api/IPC.
function catalogWith(descriptors: SkillDescriptor[]): SkillCatalog {
    return new SkillCatalog(undefined as never, () => Promise.resolve(descriptors))
}

test('dedupes by precedence: project shadows global shadows packaged', async () => {
    const c = catalogWith([d('dup', SkillScope.Packaged), d('dup', SkillScope.Global), d('dup', SkillScope.Project), d('solo', SkillScope.Global)])
    await c.discover('/proj')
    const dup = c.All.filter(s => s.Name === 'dup')
    expect(dup).toHaveLength(1)
    expect(dup[0].Scope).toBe(SkillScope.Project)
    expect(c.All.map(s => s.Name).sort()).toEqual(['dup', 'solo'])
})

test('search matches name, title, description, tags, category (case-insensitive)', async () => {
    const c = catalogWith([d('alpha', SkillScope.Project, { tags: ['c4'] }), d('beta', SkillScope.Project, { category: 'Diagrams' })])
    await c.discover('/proj')
    expect(c.search('C4').map(s => s.Name)).toEqual(['alpha'])
    expect(c.search('diagr').map(s => s.Name)).toEqual(['beta'])
})

test('forProjectType filters on the requiresProjectType gate', async () => {
    const c = catalogWith([d('arch-only', SkillScope.Project, { requiresProjectType: [ProjectType.Architecture] }), d('any', SkillScope.Project)])
    await c.discover('/proj')
    expect(c.forProjectType(ProjectType.Library).map(s => s.Name)).toEqual(['any'])
    expect(c.forProjectType(ProjectType.Architecture).map(s => s.Name).sort()).toEqual(['any', 'arch-only'])
})
