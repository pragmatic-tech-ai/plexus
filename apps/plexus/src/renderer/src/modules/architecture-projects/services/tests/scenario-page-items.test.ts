import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'
import { scenarioPageItems } from '../arch-model-toolbox-contributor.js'
import { ArchScenarioDropFactoryKey } from '../arch-scenario-drop-factory.js'
import type { TodlPresentationRegistry } from '../../../diagram/services/todl-presentation-registry.js'

const reg = { iconKeyFor: () => undefined } as unknown as TodlPresentationRegistry

const MM = `namespace archmm {
  concept scenario {}
  concept service {}
  viewpoint S : frames scenario
  viewpoint V : frames service
}`

function buildModel(): ArchModel {
    const draft = ModelDraft.fromSources(
        [new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))],
        [], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
}

test('lists one scenario: item per in-scope scenario entity', () => {
    const model = buildModel()
    const sc = model.createInViewpoint('scenario', 'S')
    model.createInViewpoint('service', 'V')   // not a scenario

    const items = scenarioPageItems(model, new Set(['S']), reg)
    expect(items.map((i) => i.Id)).toEqual(['scenario:' + sc.id])
    expect(items[0].FactoryKey).toBe(ArchScenarioDropFactoryKey)
})

test('excludes scenarios not framed by the diagram scope', () => {
    const model = buildModel()
    model.createInViewpoint('scenario', 'S')

    expect(scenarioPageItems(model, new Set<string>(), reg)).toEqual([])
})
