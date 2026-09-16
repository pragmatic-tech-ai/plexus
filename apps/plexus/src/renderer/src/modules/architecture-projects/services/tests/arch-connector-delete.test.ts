import { test, expect, vi } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { DiagramDocument } from '@pragmatic-tech-ai/mural/framework'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBinding } from '../arch-diagram-binding.js'
import { ArchNodeVM } from '../arch-node-vm.js'
import { mintConnectorEntity, isConnectorEntity } from '../connector-entity.js'

const MM = `namespace archmm {
  concept component {}
  concept connector {
    relationship from -> component;
    relationship to -> component;
  }
  taxonomy connectors : represents connector { term calls {} }
  viewpoint V : frames component, connector
}`

function setup() {
    const draft = ModelDraft.fromSources(
        [new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))],
        [], { namespace: 'archmm' })
    const model = new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
    vi.spyOn(model, 'save').mockResolvedValue()
    const a = model.createInViewpoint('component', 'V')
    const b = model.createInViewpoint('component', 'V')
    const connId = mintConnectorEntity(model, a.id, b.id, 'calls')

    const doc = new DiagramDocument()
    const va = new ArchNodeVM(); va.Id = a.id
    const vb = new ArchNodeVM(); vb.Id = b.id
    doc.Nodes.Add(va); doc.Nodes.Add(vb)
    const binding = new ArchDiagramBinding(doc, model)
    binding.attach()
    return { model, binding, doc, connId }
}

const connectorEntities = (model: ArchModel) => model.entities().filter((e) => isConnectorEntity(model.repository(), e))

test('Shift+Delete on a projected connector-entity edge removes the connector entity', () => {
    const { model, binding, doc, connId } = setup()
    const projected = doc.Connectors.ToArray()
    expect(projected.length).toBe(1)
    const remove = vi.spyOn(model, 'remove')

    binding.handleDeleteRequested([], projected, true)

    expect(remove).toHaveBeenCalledWith(connId)
    expect(model.save).toHaveBeenCalled()
    expect(connectorEntities(model).length).toBe(0)
})

test('plain Delete on a projected connector-entity edge leaves the entity (re-projects on reload)', () => {
    const { model, binding, doc } = setup()
    const projected = doc.Connectors.ToArray()
    const remove = vi.spyOn(model, 'remove')

    binding.handleDeleteRequested([], projected, false)

    expect(remove).not.toHaveBeenCalled()
    expect(connectorEntities(model).length).toBe(1)
})
