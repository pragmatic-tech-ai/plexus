import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'

// Meta-model with a containment-shaped relationship: a component points at its
// location via `in`.
const MM = `namespace archmm {
  concept location {}
  concept component { relationship in -> location; }
  viewpoint ComponentView : frames component, location
}`
const file = { uri: 'model.todl', text: `namespace archmm {
  model Arch : archmm conforms ComponentView { location loc {} component comp { in = loc; } }
}` }

function buildModel(): ArchModel {
    const mmDoc = toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)
    const baseRepo = new Repository(graphFromJSON(mmDoc))
    const draft = ModelDraft.fromSources([baseRepo], [file], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
}

test('removeRef drops the ref and fires onChanged', () => {
    const m = buildModel()
    const comp = () => m.entities().find((e) => e.id === 'comp')!
    expect(comp().refs('in').map((e) => e.id)).toEqual(['loc'])

    let fired = 0
    m.onChanged(() => { fired++ })
    m.removeRef('comp', 'in', 'loc')

    expect(comp().refs('in')).toEqual([])
    expect(fired).toBe(1)
})
