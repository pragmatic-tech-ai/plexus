import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'
import { modelPageItems, scenarioPageItems, conceptToolboxVisible } from '../arch-model-toolbox-contributor.js'
import type { TodlPresentationRegistry } from '../../../diagram/services/todl-presentation-registry.js'

const reg = { iconKeyFor: () => undefined } as unknown as TodlPresentationRegistry

// service: hidden (visible = false); widget: visible = true; gadget: no annotation.
// A scenario concept is hidden so the Scenarios page collapses.
const MM = `namespace archmm {
  annotation toolbox { visible : boolean; }
  concept service { annotate toolbox { visible = false; } }
  concept widget  { annotate toolbox { visible = true; } }
  concept gadget  {}
  concept step { relationship src -> widget; relationship dst -> widget; }
  concept sequence { relationship steps -> step; }
  concept scenario { annotate toolbox { visible = false; } relationship sequences -> sequence; }
  viewpoint V : frames service, widget, gadget
  viewpoint S : frames scenario, sequence, step
}`

function buildModel(): ArchModel {
    const draft = ModelDraft.fromSources(
        [new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))],
        [], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
}

test('conceptToolboxVisible: opt-out false, explicit true, and absent (default visible)', () => {
    const repo = buildModel().repository()
    expect(conceptToolboxVisible(repo, 'service')).toBe(false)
    expect(conceptToolboxVisible(repo, 'widget')).toBe(true)
    expect(conceptToolboxVisible(repo, 'gadget')).toBe(true)   // no annotation → visible
})

test('modelPageItems drops entities whose concept opts out of the toolbox', () => {
    const model = buildModel()
    model.createInViewpoint('service', 'V')          // hidden
    const w = model.createInViewpoint('widget', 'V') // visible = true
    const g = model.createInViewpoint('gadget', 'V') // no annotation → visible

    const ids = modelPageItems(model, new Set(['V']), new Set(), reg).map((i) => i.Id).sort()
    expect(ids).toEqual(['instance:' + g.id, 'instance:' + w.id].sort())
})

test('scenarioPageItems is empty when the scenario concept opts out', () => {
    const model = buildModel()
    model.createInViewpoint('scenario', 'S')
    expect(scenarioPageItems(model, new Set(['S']), reg)).toEqual([])
})
