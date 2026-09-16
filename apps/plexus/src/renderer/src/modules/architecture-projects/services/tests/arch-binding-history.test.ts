import { test, expect, beforeAll } from 'vitest'
import { Application } from '@pragmatic-tech-ai/mural/runtime'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { DiagramDocument } from '@pragmatic-tech-ai/mural/framework'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBinding } from '../arch-diagram-binding.js'
import { ArchNodeVM } from '../arch-node-vm.js'
import { registerArchNodeSerializer } from '../arch-node-serializer.js'

const MM = `namespace archmm {
  concept Component {}
  viewpoint ComponentView : frames Component
}`
const fileA = { uri: 'model-a.todl', text: `namespace archmm {
  model Arch : archmm conforms ComponentView { Component web {} }
}` }

// "arch" node serializer must be registered so a diagram-layer restore keeps arch
// nodes (see arch-node-serialize.test.ts). Idempotent.
beforeAll(() => { Application.current = null; new Application(); registerArchNodeSerializer() })

// Drain the history safety-net microtask (queueMicrotask) so an unbracketed setup
// edit (adding a node) commits before the assertions run.
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

function buildModel(storage: FakeStorage): ArchModel {
    const mmDoc = toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)
    const base = new Repository(graphFromJSON(mmDoc))
    const draft = ModelDraft.fromSources([base], [fileA], { namespace: 'archmm' })
    return new ArchModel(draft, storage, 'archmm', base)   // 4-arg: base enables restore
}

test('a rename through the binding is one undo entry that reverts the model', async () => {
    const model = buildModel(new FakeStorage('fake://Arch'))
    const doc = new DiagramDocument()
    const web = new ArchNodeVM(); web.Id = 'web'; doc.Nodes.Add(web)
    const binding = new ArchDiagramBinding(doc, model)
    binding.attach()
    await flush()                    // let the node-add safety-net transaction settle
    expect(web.Label).toBe('web')    // id fallback before rename

    // Commit an in-place title edit → the binding brackets Begin('Rename')/Commit.
    web.BeginEdit(); web.EditingLabel = 'Web App'; web.CommitEdit()
    expect(model.entities().find((e) => e.id === 'web')?.field('label')).toBe('Web App')
    expect(doc.History.CanUndo).toBe(true)

    doc.Undo()
    // Model draft restored + reconcile rescanned: the label reverts to the id fallback.
    expect(model.entities().find((e) => e.id === 'web')?.field('label')).toBeUndefined()
    const restored = doc.Nodes.ToArray().find((n) => n instanceof ArchNodeVM && n.Id === 'web') as ArchNodeVM | undefined
    expect(restored?.Label).toBe('web')
})

test('dispose unregisters the model layer', () => {
    const model = buildModel(new FakeStorage('fake://Arch2'))
    const doc = new DiagramDocument()          // no nodes → no safety-net transaction
    const binding = new ArchDiagramBinding(doc, model)
    binding.attach()
    binding.dispose()

    // With the layer gone and nothing changing diagram-side, a bracketed model
    // change is a no-op transaction — the model is not recorded, so no undo entry.
    doc.History.Begin('after-dispose')
    model.setField('web', 'label', 'ShouldNotUndo')
    doc.History.Commit()
    expect(doc.History.CanUndo).toBe(false)
})
