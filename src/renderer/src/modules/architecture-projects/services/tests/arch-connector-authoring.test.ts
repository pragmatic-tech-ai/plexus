import { test, expect, vi } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { DiagramDocument } from '@pragmatic-tech-ai/mural/framework'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBinding } from '../arch-diagram-binding.js'
import { ArchNodeVM } from '../arch-node-vm.js'
import type { ConnectorAction } from '../arch-connector-resolver.js'

const MM = `namespace archmm {
  concept technology {}
  concept component { relationship realisedBy -> technology; }
  concept host {
    relationship runs -> technology;
    relationship hosts -> technology;
  }
  viewpoint V : frames component, technology, host
}`

function buildModel(): ArchModel {
    const draft = ModelDraft.fromSources(
        [new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))],
        [], { namespace: 'archmm' })
    const model = new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
    vi.spyOn(model, 'save').mockResolvedValue()
    return model
}

// Place a source + target entity as nodes, attach a binding with a stub chooser.
function setup(model: ArchModel, srcConcept: string, tgtConcept: string) {
    const src = model.createInViewpoint(srcConcept, 'V')
    const tgt = model.createInViewpoint(tgtConcept, 'V')
    const doc = new DiagramDocument()
    const a = new ArchNodeVM(); a.Id = src.id
    const b = new ArchNodeVM(); b.Id = tgt.id
    doc.Nodes.Add(a); doc.Nodes.Add(b)
    let shown: { actions: readonly ConnectorAction[]; onPick: (a: ConnectorAction) => void } | undefined
    const chooser = { Show: vi.fn((actions: readonly ConnectorAction[], onPick: (a: ConnectorAction) => void) => { shown = { actions, onPick } }) }
    const binding = new ArchDiagramBinding(doc, model, chooser as never)
    binding.attach()
    return { binding, src, tgt, a, b, chooser, getShown: () => shown }
}

test('one candidate → auto-writes the ref (no chooser)', () => {
    const model = buildModel()
    const { binding, src, tgt, a, b, chooser } = setup(model, 'component', 'technology')
    const addRef = vi.spyOn(model, 'addRef')

    binding.handleConnectorCreated(a, b)

    expect(addRef).toHaveBeenCalledWith(src.id, 'realisedBy', tgt.id)
    expect(model.save).toHaveBeenCalled()
    expect(chooser.Show).not.toHaveBeenCalled()
})

test('zero candidates → no ref written, but the raw connector is reconciled (notifyChanged)', () => {
    const model = buildModel()
    // technology has no relationship members → technology→component yields 0.
    const { binding, a, b } = setup(model, 'technology', 'component')
    const addRef = vi.spyOn(model, 'addRef')
    const notify = vi.spyOn(model, 'notifyChanged')

    binding.handleConnectorCreated(a, b)

    expect(addRef).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalled()   // reconciles away the raw connector
})

test('many candidates → chooser, and the pick writes the chosen ref', () => {
    const model = buildModel()
    const { binding, src, tgt, a, b, chooser, getShown } = setup(model, 'host', 'technology')
    const addRef = vi.spyOn(model, 'addRef')

    binding.handleConnectorCreated(a, b)

    expect(chooser.Show).toHaveBeenCalledOnce()
    const shown = getShown()!
    expect(shown.actions.map((x) => x.member).sort()).toEqual(['hosts', 'runs'])
    expect(addRef).not.toHaveBeenCalled()   // deferred until pick

    shown.onPick(shown.actions.find((x) => x.member === 'hosts')!)
    expect(addRef).toHaveBeenCalledWith(src.id, 'hosts', tgt.id)
})

test('endpoints that are not bound arch nodes are ignored', () => {
    const model = buildModel()
    const { binding, b } = setup(model, 'component', 'technology')
    const addRef = vi.spyOn(model, 'addRef')

    const unbound = new ArchNodeVM(); unbound.Id = 'not-an-entity'
    binding.handleConnectorCreated(unbound, b)

    expect(addRef).not.toHaveBeenCalled()
})
