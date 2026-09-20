import { test, expect } from 'vitest'
import { SkillCatalog } from '../skill-catalog.js'
import { AgentSkillKind } from '../../../../../../shared/agent-api.js'
import { SkillScope, SkillSourceKind, ProjectType, type SkillDescriptor } from '../../../../../../shared/skill-api.js'

function d(name: string, scope: SkillScope, over: Partial<SkillDescriptor> = {}): SkillDescriptor
{
    return {
        kind: AgentSkillKind.Skill, name, title: name, description: '', scope,
        sourceKind: SkillSourceKind.ClaudeCode, tags: [], requiresProjectType: [], allowedTools: [],
        inputs: [], bindings: [], outputs: [], problems: [], folderPath: `/${scope}/${name}`, ...over,
    }
}

// SkillCatalog takes an injected loader so the test needs no window.api/IPC.
function catalogWith(descriptors: SkillDescriptor[]): SkillCatalog
{
    return new SkillCatalog(undefined as never, () => Promise.resolve(descriptors))
}

test('same-name skills across scopes all survive (no cross-scope shadowing)', async () => {
    const c = catalogWith([d('dup', SkillScope.Packaged), d('dup', SkillScope.Global), d('dup', SkillScope.Project), d('solo', SkillScope.Global)])
    await c.discover('/proj')
    expect(c.All.filter(s => s.Name === 'dup')).toHaveLength(3)
    expect(c.All.map(s => s.Name).sort()).toEqual(['dup', 'dup', 'dup', 'solo'])
})

test('discover tags project skills with the scanned dir as their origin', async () => {
    const c = catalogWith([d('p', SkillScope.Project), d('g', SkillScope.Global)])
    await c.discover('/proj')
    expect(c.All.find(s => s.Name === 'p')!.OriginProjectPath).toBe('/proj')
    expect(c.All.find(s => s.Name === 'g')!.OriginProjectPath).toBeUndefined()
})

test('discoverAll unions projects: project skills stay distinct per origin, shared scopes collapse', async () => {
    const perDir: Record<string, SkillDescriptor[]> = {
        '/a': [d('review', SkillScope.Project), d('shared', SkillScope.Global), d('pkg', SkillScope.Packaged)],
        '/b': [d('review', SkillScope.Project), d('shared', SkillScope.Global), d('pkg', SkillScope.Packaged)],
    }
    const c = new SkillCatalog(undefined as never, (dir) => Promise.resolve(perDir[dir] ?? []))
    await c.discoverAll(['/a', '/b'])
    const reviews = c.All.filter(s => s.Name === 'review')
    expect(reviews.map(s => s.OriginProjectPath).sort()).toEqual(['/a', '/b'])
    expect(c.All.filter(s => s.Name === 'shared')).toHaveLength(1)
    expect(c.All.filter(s => s.Name === 'pkg')).toHaveLength(1)
})

test('forProject narrows to a project own skills plus the shared scopes', async () => {
    const perDir: Record<string, SkillDescriptor[]> = {
        '/a': [d('a-only', SkillScope.Project), d('shared', SkillScope.Global)],
        '/b': [d('b-only', SkillScope.Project), d('shared', SkillScope.Global)],
    }
    const c = new SkillCatalog(undefined as never, (dir) => Promise.resolve(perDir[dir] ?? []))
    await c.discoverAll(['/a', '/b'])
    expect(c.forProject('/a').map(s => s.Name).sort()).toEqual(['a-only', 'shared'])
    expect(c.forProject('/b').map(s => s.Name).sort()).toEqual(['b-only', 'shared'])
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
