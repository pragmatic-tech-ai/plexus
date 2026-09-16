import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft, type Entity } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'
import { edgeKey, desiredEdges, connectorVisualKey, CONNECTOR_ENTITY_MEMBER_PREFIX } from '../edge-projection.js'

// component references service via `uses`; both framed by V.
const MM = `namespace archmm {
  concept service {}
  concept component { relationship uses -> service; }
  viewpoint V : frames component, service
}`

function buildModel(): ArchModel {
    const draft = ModelDraft.fromSources(
        [new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))],
        [], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
}

function placedMap(model: ArchModel, ids: string[]): Map<string, Entity> {
    const byId = new Map(model.entities().map((e) => [e.id, e]))
    return new Map(ids.map((id) => [id, byId.get(id)!]))
}

test('edgeKey is stable and unique per (from, member, to)', () => {
    expect(edgeKey('a', 'uses', 'b')).toBe('a|uses|b')
    expect(edgeKey('a', 'uses', 'b')).not.toBe(edgeKey('a', 'calls', 'b'))
})

test('desiredEdges emits one edge per in-scope relationship between two placed entities', () => {
    const model = buildModel()
    const comp = model.createInViewpoint('component', 'V')
    const svc = model.createInViewpoint('service', 'V')
    model.addRef(comp.id, 'uses', svc.id)

    const placed = placedMap(model, [comp.id, svc.id])
    const edges = desiredEdges(model.repository(), placed, new Set(['V']))
    expect([...edges]).toEqual([edgeKey(comp.id, 'uses', svc.id)])
})

test('desiredEdges omits edges to an unplaced target', () => {
    const model = buildModel()
    const comp = model.createInViewpoint('component', 'V')
    const svc = model.createInViewpoint('service', 'V')
    model.addRef(comp.id, 'uses', svc.id)

    const placed = placedMap(model, [comp.id])   // svc not placed
    expect([...desiredEdges(model.repository(), placed, new Set(['V']))]).toEqual([])
})

test('desiredEdges omits edges when the target concept is out of scope', () => {
    const model = buildModel()
    const comp = model.createInViewpoint('component', 'V')
    const svc = model.createInViewpoint('service', 'V')
    model.addRef(comp.id, 'uses', svc.id)

    const placed = placedMap(model, [comp.id, svc.id])
    expect([...desiredEdges(model.repository(), placed, new Set(['OTHER']))]).toEqual([])
})

test('connectorVisualKey re-keys a connector-ENTITY edge by (from, type, to) so it is load-stable', () => {
    // Two loads mint different synthetic ids for the same authored `a --> b` edge;
    // both must map to the SAME visual key so a saved reroute matches on reopen.
    const load1 = edgeKey('component4', `${CONNECTOR_ENTITY_MEMBER_PREFIX}:omtsvyibn00g`, 'component2')
    const load2 = edgeKey('component4', `${CONNECTOR_ENTITY_MEMBER_PREFIX}:omtsvz671009`, 'component2')
    const stable = edgeKey('component4', `${CONNECTOR_ENTITY_MEMBER_PREFIX}:calls`, 'component2')
    expect(connectorVisualKey(load1, 'calls')).toBe(stable)
    expect(connectorVisualKey(load2, 'calls')).toBe(stable)
    expect(connectorVisualKey(load1, 'calls')).toBe(connectorVisualKey(load2, 'calls'))
})

test('connectorVisualKey leaves a relationship / scenario-step edge key unchanged (already stable)', () => {
    const relKey = edgeKey('comp', 'uses', 'svc')
    expect(connectorVisualKey(relKey, 'calls')).toBe(relKey)
})
