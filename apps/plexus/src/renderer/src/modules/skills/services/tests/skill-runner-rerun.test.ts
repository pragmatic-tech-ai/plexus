import { test, expect } from 'vitest'
import { SkillRunner, type RunnerDeps } from '../skill-runner.js'
import { Skill } from '../skill.js'
import { AgentSkillKind } from '../../../../../../shared/agent-api.js'
import { SkillScope, SkillSourceKind, InputKind, type SkillDescriptor } from '../../../../../../shared/skill-api.js'
import type { BindingContextSources } from '../binding-resolver.js'
import type { ResolvedInput } from '../../../../../../shared/skill-context-api.js'

function skill(): Skill
{
    const d: SkillDescriptor = {
        kind: AgentSkillKind.Skill, name: 'gen', title: 'gen', description: '', scope: SkillScope.Project,
        sourceKind: SkillSourceKind.PlexusSuperset, tags: [], requiresProjectType: [], allowedTools: [],
        inputs: [{ key: 'vp', label: 'V', type: InputKind.Text }], bindings: [], outputs: [], problems: [], folderPath: '/p',
    }
    return new Skill(d)
}

const emptySources: BindingContextSources = {
    currentProject: () => undefined, diagramSelection: () => undefined, activeDocument: () => undefined,
    primaryEntity: () => undefined, workspaceRoot: () => undefined,
}

test('run passes a rerun thunk that re-opens the form seeded with the collected inputs', async () => {
    const seedsSeen: Array<ResolvedInput[] | undefined> = []
    let rerun: (() => void) | undefined
    const deps: RunnerDeps = {
        presentForm: async (_skill, seed) => { seedsSeen.push(seed); return [{ key: 'vp', value: 'chosen' }] },
        bindingSourcesFor: () => emptySources,
        runAgentSkill: (_i, _d, _n, opts) => { rerun = opts?.rerun; return { Id: 's' } },
    }
    const r = new SkillRunner(undefined as never, deps)
    await r.run(skill(), '/p', 'P')
    expect(seedsSeen[0]).toBeUndefined()          // first run: no seed
    expect(rerun).toBeDefined()

    rerun!()                                       // re-run
    await Promise.resolve(); await Promise.resolve()
    expect(seedsSeen[1]).toEqual([{ key: 'vp', value: 'chosen' }])  // seeded with the recorded inputs
})
