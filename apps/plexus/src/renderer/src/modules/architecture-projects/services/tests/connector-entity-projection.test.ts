import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { DiagramDocument } from '@pragmatic-tech-ai/mural/framework'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBinding } from '../arch-diagram-binding.js'
import { ArchNodeVM } from '../arch-node-vm.js'
import { mintConnectorEntity } from '../connector-entity.js'
import { desiredConnectorEntityEdges, connectorEntityIdOf } from '../edge-projection.js'

const MM = `namespace archmm {
  concept location {}
  concept component { relationship in -> location?; }
  concept connector {
    relationship from -> component;
    relationship to -> component;
  }
  taxonomy connectors : represents connector {
    term calls {}
    term event {}
  }
  viewpoint V : frames component, location, connector
}`

function buildModel(): ArchModel {
    const draft = ModelDraft.fromSources(
        [new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))],
        [], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
}

test('desiredConnectorEntityEdges yields one keyed edge per placed connector entity', () => {
    const model = buildModel()
    const a = model.createInViewpoint('component', 'V')
    const b = model.createInViewpoint('component', 'V')
    const cid = mintConnectorEntity(model, a.id, b.id, 'event')

    const repo = model.repository()
    const scope = new Set(repo.viewpoints())
    const edges = desiredConnectorEntityEdges(repo, model.entities(), new Set([a.id, b.id]), scope)

    expect(edges.size).toBe(1)
    const [key, type] = [...edges][0]
    expect(type).toBe('event')
    expect(connectorEntityIdOf(key)).toBe(cid)

    // An endpoint that isn't placed → no edge.
    const only = desiredConnectorEntityEdges(repo, model.entities(), new Set([a.id]), scope)
    expect(only.size).toBe(0)
})

test('a connector entity between two placed nodes projects as one labeled connector', () => {
    const model = buildModel()
    const a = model.createInViewpoint('component', 'V')
    const b = model.createInViewpoint('component', 'V')
    mintConnectorEntity(model, a.id, b.id, 'calls')

    const doc = new DiagramDocument()
    const va = new ArchNodeVM(); va.Id = a.id
    const vb = new ArchNodeVM(); vb.Id = b.id
    doc.Nodes.Add(va); doc.Nodes.Add(vb)

    const binding = new ArchDiagramBinding(doc, model)
    binding.attach()

    const connectors = doc.Connectors.ToArray()
    expect(connectors.length).toBe(1)
    expect(connectors[0].Source?.Node).toBe(va)
    expect(connectors[0].Target?.Node).toBe(vb)
    expect(connectors[0].LabelText).toBe('calls')
})
