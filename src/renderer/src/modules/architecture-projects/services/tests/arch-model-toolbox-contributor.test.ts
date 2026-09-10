import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'
import { modelPageItems, scenarioPageTitle } from '../arch-model-toolbox-contributor.js'
import { ArchModelInstanceDropFactoryKey } from '../arch-model-instance-drop-factory.js'

const MM = `namespace archmm {
  concept service {}
  concept widget {}
  viewpoint V : frames service
  viewpoint W : frames widget
}`

function buildModel(): ArchModel {
    const draft = ModelDraft.fromSources(
        [new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))],
        [], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
}

test('modelPageItems lists in-scope, not-yet-placed entities as instance items', () => {
    const model = buildModel()
    const svc = model.createInViewpoint('service', 'V')
    model.createInViewpoint('widget', 'W')   // out of scope for {V}

    const items = modelPageItems(model, new Set(['V']), new Set())
    expect(items.map((i) => i.Id)).toEqual(['instance:' + svc.id])
    expect(items[0].FactoryKey).toBe(ArchModelInstanceDropFactoryKey)
})

test('modelPageItems excludes already-placed entities', () => {
    const model = buildModel()
    const svc = model.createInViewpoint('service', 'V')

    const items = modelPageItems(model, new Set(['V']), new Set([svc.id]))
    expect(items).toEqual([])
})

test('modelPageItems excludes out-of-scope entities', () => {
    const model = buildModel()
    model.createInViewpoint('widget', 'W')

    expect(modelPageItems(model, new Set(['V']), new Set())).toEqual([])
})

test('scenarioPageTitle carries the model namespace, mirroring the model page', () => {
    expect(scenarioPageTitle(buildModel())).toBe('Scenarios: archmm')
})
