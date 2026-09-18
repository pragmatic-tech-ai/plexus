import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { AgentSkillKind } from '../../../../../../shared/agent-api.js'

import { SkillCatalog } from '../skill-catalog.js'
import { SkillRunner } from '../skill-runner.js'
import { SkillProjectMenuSource } from '../project-menu-source.js'

const OP = { Folder: 'C:/p', Name: 'P', Factory: { requiresMetaModel: false } } as never

test('MenuFor builds ProjectMenuChoices from the project catalog', async () => {
    const provider = new ServiceProvider()
    const skill = { Kind: AgentSkillKind.Skill, Name: 'build', appliesToProjectType: () => true }
    let ran = 0
    provider.registerInstance(SkillCatalog.Key, { discoverAll: async () => {}, forProject: () => [skill] } as never)
    provider.registerInstance(SkillRunner.Key, { run: () => { ran++ } } as never)

    const choices = await new SkillProjectMenuSource(provider).MenuFor(OP)
    expect(choices.map((c) => c.Label)).toEqual(['skill: build'])
    choices[0]!.Command.Execute(undefined)
    expect(ran).toBe(1)
})

test('MenuFor returns empty when no catalog or runner is registered', async () => {
    const provider = new ServiceProvider()
    const choices = await new SkillProjectMenuSource(provider).MenuFor(OP)
    expect(choices).toEqual([])
})
