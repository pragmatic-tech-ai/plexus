import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { DiagramDocument, ToolboxVisualDescriptor } from '@pragmatic-tech-ai/mural/framework'
import { TodlVisualResolverKey } from '../../../diagram/services/todl-visual-resolver.js'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBinding } from '../arch-diagram-binding.js'
import { ArchNodeVM } from '../arch-node-vm.js'

const MM = `namespace archmm {
  concept component {}
  viewpoint ComponentView : frames component
}`
function buildModel(): ArchModel {
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))], [], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
}

test('an ArchNodeVM added after attach gets Label + Descriptor derived from the entity on notifyChanged', () => {
    const model = buildModel()
    const doc = new DiagramDocument()
    const binding = new ArchDiagramBinding(doc, model)
    binding.attach()

    // Simulate a drop: create the entity, add an ArchNodeVM, set its Id, notify.
    const e = model.createInViewpoint('component', 'ComponentView')
    const vm = new ArchNodeVM()
    vm.Id = e.id
    doc.Nodes.Add(vm)
    model.notifyChanged()

    // Label is derived from entity (no label/name field → id fallback).
    expect(vm.Label).toBe(e.id)
    // Descriptor uses entity.concept (the concept id, bare — library-term case).
    expect(vm.Descriptor).toEqual(new ToolboxVisualDescriptor(TodlVisualResolverKey, e.concept))
})

test('reload-shaped: ArchNodeVM with empty Label/Descriptor has both derived by rescan after attach', () => {
    const model = buildModel()
    const doc = new DiagramDocument()

    // Pre-populate an entity in the model.
    const e = model.createInViewpoint('component', 'ComponentView')

    // Simulate post-deserialize state: ArchNodeVM has Id (persisted) but empty Label/Descriptor.
    const vm = new ArchNodeVM()
    vm.Id = e.id
    // Label defaults to '' and Descriptor to undefined — as after deserialize.
    expect(vm.Label).toBe('')
    expect(vm.Descriptor).toBeUndefined()

    doc.Nodes.Add(vm)

    const binding = new ArchDiagramBinding(doc, model)
    binding.attach()   // triggers rescan()

    expect(vm.Label).toBe(e.id)   // id fallback (no label/name)
    expect(vm.Descriptor).toEqual(new ToolboxVisualDescriptor(TodlVisualResolverKey, e.concept))
})

test('deleting the entity removes the ArchNodeVM from the doc', () => {
    const model = buildModel()
    const doc = new DiagramDocument()
    const binding = new ArchDiagramBinding(doc, model)
    binding.attach()

    const e = model.createInViewpoint('component', 'ComponentView')
    const vm = new ArchNodeVM()
    vm.Id = e.id
    doc.Nodes.Add(vm)
    model.notifyChanged()

    // Now remove the entity — the VM should disappear.
    model.remove(e.id)
    const ids = doc.Nodes.ToArray().map((n) => n instanceof ArchNodeVM ? n.Id : undefined)
    expect(ids).not.toContain(e.id)
})

test('model is exposed for the binding service', () => {
    const model = buildModel()
    const binding = new ArchDiagramBinding(new DiagramDocument(), model)
    expect(binding.model).toBe(model)
})
