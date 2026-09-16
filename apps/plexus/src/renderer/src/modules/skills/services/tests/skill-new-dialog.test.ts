import { test, expect } from 'vitest'
import { SkillNewFormVm, ProjectChoice } from '../skill-new-dialog.js'
import { SkillScope } from '../../../../../../shared/skill-api.js'
import type { NewSkillRequest } from '../skill-scaffolder.js'

const projects = [new ProjectChoice('alpha', '/a'), new ProjectChoice('beta', '/b')]

function collect(scope: SkillScope, pick?: ProjectChoice): NewSkillRequest | undefined {
    let out: NewSkillRequest | undefined
    const form = new SkillNewFormVm(scope, projects, (r) => { out = r ?? undefined })
    form.Name = 'My Skill'
    if (pick !== undefined) form.SelectedProject = pick
    form.ConfirmCommand.Execute(undefined)
    return out
}

test('Project scope carries the chosen project dir in the request', () => {
    const req = collect(SkillScope.Project, projects[1])
    expect(req!.scope).toBe(SkillScope.Project)
    expect(req!.projectDir).toBe('/b')
})

test('Project scope defaults to the first open project', () => {
    const req = collect(SkillScope.Project)
    expect(req!.projectDir).toBe('/a')
})

test('Global scope leaves projectDir undefined', () => {
    const req = collect(SkillScope.Global, projects[0])
    expect(req!.scope).toBe(SkillScope.Global)
    expect(req!.projectDir).toBeUndefined()
})

test('ShowProjectPicker only for Project scope with more than one project', () => {
    const many = new SkillNewFormVm(SkillScope.Project, projects, () => {})
    expect(many.ShowProjectPicker).toBe(true)
    many.Scope = SkillScope.Global
    expect(many.ShowProjectPicker).toBe(false)

    const one = new SkillNewFormVm(SkillScope.Project, [projects[0]], () => {})
    expect(one.ShowProjectPicker).toBe(false)
})

test('ProjectChoice displays its label via toString', () => {
    expect(String(new ProjectChoice('my-proj', '/x/my-proj'))).toBe('my-proj')
})
