import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
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

function buildModel(): ArchModel {
    const mmDoc = toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)
    const baseRepo = new Repository(graphFromJSON(mmDoc))
    const draft = ModelDraft.fromSources([baseRepo], [fileA, fileB], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
}

test('namespace + entities expose the composed own instances', () => {
    const m = buildModel()
    expect(m.namespace).toBe('archmm')
    expect(m.entities().map((e) => e.id).sort()).toEqual(['host', 'web'])
})

test('viewpoints() lists framed concepts and subtype-aware members', () => {
    const m = buildModel()
    const vps = new Map(m.viewpoints().map((v) => [v.id, v]))
    expect([...vps.keys()].sort()).toEqual(['ComponentView', 'DeploymentView'])
    expect(vps.get('ComponentView')!.framedConcepts).toEqual(['Component'])
    expect(vps.get('ComponentView')!.members.map((e) => e.id)).toEqual(['web'])
    // DeploymentView frames Node + Component, so both host and web are members.
    expect(vps.get('DeploymentView')!.members.map((e) => e.id).sort()).toEqual(['host', 'web'])
})

test('repository() returns the working repo composing base concepts + own instances', () => {
    const m = buildModel()
    const repo = m.repository()
    expect(repo.resolve('Component')?.typeOf).toBe('concept')   // from the meta-model base
    expect(repo.resolve('web')?.typeOf).toBe('Component')       // own instance over the base
})
