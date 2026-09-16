import { test, expect } from 'vitest'
import { join } from 'node:path'
import { SkillScopeResolver } from '../skill-scope-resolver.js'
import { SkillScope } from '../../../shared/skill-api.js'

const resolver = new SkillScopeResolver({ home: '/home/u', userData: '/data' })

test('project scope points at the project .claude/skills + agents', () => {
    const roots = resolver.rootsFor('/proj')
    const project = roots.find(r => r.scope === SkillScope.Project)!
    expect(project.skillsDir).toBe(join('/proj', '.claude', 'skills'))
    expect(project.agentsDir).toBe(join('/proj', '.claude', 'agents'))
})

test('global scope points at ~/.claude/skills', () => {
    const g = resolver.rootsFor('/proj').find(r => r.scope === SkillScope.Global)!
    expect(g.skillsDir).toBe(join('/home/u', '.claude', 'skills'))
})

test('packaged scope yields both library and meta-model package backends', () => {
    const packaged = resolver.rootsFor('/proj').filter(r => r.scope === SkillScope.Packaged)
    const dirs = packaged.map(r => r.skillsDir)
    expect(dirs).toContain(join('/data', 'libraries'))
    expect(dirs).toContain(join('/data', 'meta-models'))
})
