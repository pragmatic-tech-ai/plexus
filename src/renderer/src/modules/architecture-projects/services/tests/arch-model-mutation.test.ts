import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft, checkAgainst, Severity } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'

const MM = `namespace archmm {
  concept Component {}
  concept Node {}
  viewpoint ComponentView : frames Component
  viewpoint DeploymentView : frames Node, Component
}`
const fileA = { uri: 'model-a.todl', text: `namespace archmm {
  model Arch : archmm conforms ComponentView { Component web {} }
}` }
const fileB = { uri: 'model-b.todl', text: `namespace archmm {
  model Arch : archmm conforms DeploymentView { Node host {} }
}` }

function buildModel(storage = new FakeStorage('fake://Arch')): ArchModel {
    const mmDoc = toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)
    const baseRepo = new Repository(graphFromJSON(mmDoc))
    const draft = ModelDraft.fromSources([baseRepo], [fileA, fileB], { namespace: 'archmm' })
    return new ArchModel(draft, storage, 'archmm')
}

test('create adds an own entity into its home file and fires onChanged', () => {
    const m = buildModel()
    let fired = 0
    m.onChanged(() => { fired++ })
    m.create('Component', 'api', 'model-a.todl')
    expect(m.entities().map((e) => e.id).sort()).toEqual(['api', 'host', 'web'])
    expect(fired).toBe(1)
})

test('onChanged unsubscribe stops further notifications', () => {
    const m = buildModel()
    let fired = 0
    const off = m.onChanged(() => { fired++ })
    m.setField('web', 'label', 'Web')
    off()
    m.setField('web', 'label', 'Web2')
    expect(fired).toBe(1)
})

test('save writes each home file and the result recompiles clean', async () => {
    const storage = new FakeStorage('fake://Arch')
    const m = buildModel(storage)
    m.create('Component', 'api', 'model-a.todl')
    await m.save()
    const a = await storage.ReadText('model-a.todl')
    const b = await storage.ReadText('model-b.todl')
    expect(a).toContain('api')
    // Round-trip: the emitted model files recompile against the meta-model base
    // with no error-severity diagnostics.
    const mmDoc = toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)
    const diags = checkAgainst([mmDoc], [{ uri: 'model-a.todl', text: a }, { uri: 'model-b.todl', text: b }]).diagnostics
    expect(diags.filter((d) => d.severity === Severity.Error)).toEqual([])
})
