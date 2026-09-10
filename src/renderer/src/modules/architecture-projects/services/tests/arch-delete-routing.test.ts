import { test, expect, vi } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { DiagramDocument } from '@pragmatic-tech-ai/mural/framework'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBinding } from '../arch-diagram-binding.js'
import { ArchNodeVM } from '../arch-node-vm.js'

const MM = `namespace archmm {
  concept component {}
  viewpoint V : frames component
}`

function setup() {
    const draft = ModelDraft.fromSources(
        [new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))],
        [], { namespace: 'archmm' })
    const model = new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
    vi.spyOn(model, 'save').mockResolvedValue()
    const comp = model.createInViewpoint('component', 'V')
    const doc = new DiagramDocument()
    const node = new ArchNodeVM(); node.Id = comp.id
    doc.Nodes.Add(node)
    const binding = new ArchDiagramBinding(doc, model)
    binding.attach()
    return { model, binding, node, comp }
}

test('plain Delete (shift=false) does not remove the entity from the model', () => {
    const { model, binding, node } = setup()
    const remove = vi.spyOn(model, 'remove')

    binding.handleDeleteRequested([node], [], false)

    expect(remove).not.toHaveBeenCalled()
})

test('Shift+Delete removes the entity from the model and saves', () => {
    const { model, binding, node, comp } = setup()
    const remove = vi.spyOn(model, 'remove')

    binding.handleDeleteRequested([node], [], true)

    expect(remove).toHaveBeenCalledWith(comp.id)
    expect(model.save).toHaveBeenCalled()
})

test('non-arch items are ignored on Shift+Delete', () => {
    const { model, binding } = setup()
    const remove = vi.spyOn(model, 'remove')

    const unbound = new ArchNodeVM(); unbound.Id = 'not-an-entity'
    binding.handleDeleteRequested([unbound], [], true)

    expect(remove).not.toHaveBeenCalled()
})
