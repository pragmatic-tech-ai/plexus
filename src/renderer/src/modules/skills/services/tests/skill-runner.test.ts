import { test, expect } from 'vitest'
import { SkillRunner, type RunnerDeps } from '../skill-runner.js'
import { Skill } from '../skill.js'
import { AgentSkillKind } from '../../../../../../shared/agent-api.js'
import { SkillScope, SkillSourceKind, InputKind, BindingSource, type SkillDescriptor } from '../../../../../../shared/skill-api.js'
import type { BindingContextSources } from '../binding-resolver.js'
import type { ResolvedInput, SkillContext } from '../../../../../../shared/skill-context-api.js'

function skill(over: Partial<SkillDescriptor> = {}): Skill {
    return new Skill({
        kind: AgentSkillKind.Skill, name: 'gen', title: 'gen', description: '', scope: SkillScope.Project,
        sourceKind: SkillSourceKind.PlexusSuperset, tags: [], requiresProjectType: [], allowedTools: [],
        inputs: [], bindings: [], outputs: [], problems: [], folderPath: '/p', ...over,
    })
}

const emptySources: BindingContextSources = {
    currentProject: () => undefined, diagramSelection: () => undefined, activeDocument: () => undefined,
    primaryEntity: () => undefined, workspaceRoot: () => undefined,
}

function runner(deps: Partial<RunnerDeps>): { runner: SkillRunner; calls: Array<{ opts?: { contextBlock?: string; context?: SkillContext } }> } {
    const calls: Array<{ opts?: { contextBlock?: string; context?: SkillContext } }> = []
    const full: RunnerDeps = {
        presentForm: async () => { throw new Error('presentForm should not be called') },
        bindingSourcesFor: () => emptySources,
        runAgentSkill: (_item, _dir, _name, opts) => { calls.push({ opts }); return { Id: 's' } },
        ...deps,
    }
    return { runner: new SkillRunner(undefined as never, full), calls }
}

test('no-input skill hands off straight to RunAgentSkill with no context', async () => {
    const { runner: r, calls } = runner({})
    await r.run(skill(), '/p', 'P')
    expect(calls[0].opts).toBeUndefined()
})

test('input skill presents the form, resolves bindings, and appends a context block', async () => {
    const sources: BindingContextSources = { ...emptySources, currentProject: () => ({ name: 'P', path: '/p' }) }
    const { runner: r, calls } = runner({
        presentForm: async () => [{ key: 'vp', value: 'context' }] as ResolvedInput[],
        bindingSourcesFor: () => sources,
    })
    await r.run(skill({
        inputs: [{ key: 'vp', label: 'V', type: InputKind.Enum, options: ['context'], default: 'context' }],
        bindings: [{ source: BindingSource.CurrentProject }],
    }), '/p', 'P')
    expect(calls[0].opts?.contextBlock).toContain('- vp: context')
    expect(calls[0].opts?.context?.bindings[0].source).toBe(BindingSource.CurrentProject)
    expect(calls[0].opts?.context?.inputs).toEqual([{ key: 'vp', value: 'context' }])
})

test('cancelling the form aborts the run', async () => {
    const { runner: r, calls } = runner({ presentForm: async () => undefined })
    await r.run(skill({ inputs: [{ key: 'x', label: 'X', type: InputKind.Text, required: true }] }), '/p', 'P')
    expect(calls).toHaveLength(0)
})
