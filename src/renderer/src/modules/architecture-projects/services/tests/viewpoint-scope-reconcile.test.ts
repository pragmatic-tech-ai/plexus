import { test, expect } from 'vitest'
import { DiagramDocument } from '@pragmatic-tech-ai/mural/framework'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'
import { ArchNodeVM } from '../arch-node-vm.js'
import { nodesLeavingScope } from '../viewpoint-scope-reconcile.js'

// Two concepts framed by two distinct viewpoints, so narrowing to one viewpoint
// puts the other concept's nodes out of scope.
const MM = `namespace archmm {
  concept service {}
  concept store {}
  viewpoint LogicalView : frames service
  viewpoint DataView : frames store
}`
function buildModel(): ArchModel {
    const storage = new FakeStorage('fake://Acme')
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))], [], { namespace: 'archmm' })
    return new ArchModel(draft, storage, 'archmm')
}
function node(id: string): ArchNodeVM { const n = new ArchNodeVM(); n.Id = id; return n }

test('a node whose concept is framed only by an excluded viewpoint leaves scope', () => {
    const model = buildModel()
    model.create('service', 'svc1')
    model.create('store', 'db1')
    const doc = new DiagramDocument()
    doc.Nodes.Add(node('svc1'))
    doc.Nodes.Add(node('db1'))

    const leaving = nodesLeavingScope(doc, model, ['LogicalView'])
    expect(leaving.map((l) => l.id)).toEqual(['db1'])
})

test('nodes still framed by a chosen viewpoint stay', () => {
    const model = buildModel()
    model.create('service', 'svc1')
    const doc = new DiagramDocument()
    doc.Nodes.Add(node('svc1'))
    expect(nodesLeavingScope(doc, model, ['LogicalView'])).toEqual([])
})

test('empty scope (all viewpoints) removes nothing', () => {
    const model = buildModel()
    model.create('store', 'db1')
    const doc = new DiagramDocument()
    doc.Nodes.Add(node('db1'))
    expect(nodesLeavingScope(doc, model, [])).toEqual([])
})

test('a freeform node (no matching entity) is never removed', () => {
    const model = buildModel()
    const doc = new DiagramDocument()
    doc.Nodes.Add(node('not-an-entity'))
    expect(nodesLeavingScope(doc, model, ['LogicalView'])).toEqual([])
})

test('the leaving node carries the entity display label', () => {
    const model = buildModel()
    model.create('store', 'db1')
    model.setField('db1', 'label', 'Primary Store')
    const doc = new DiagramDocument()
    doc.Nodes.Add(node('db1'))
    expect(nodesLeavingScope(doc, model, ['LogicalView'])[0]!.label).toBe('Primary Store')
})
