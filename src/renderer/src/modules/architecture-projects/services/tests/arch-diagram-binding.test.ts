import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { DiagramDocument, Figure, ToolboxVisualDescriptor } from '@pragmatic-tech-ai/mural/framework'
import { TodlVisualResolverKey } from '../../../diagram/services/todl-visual-resolver.js'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBinding } from '../arch-diagram-binding.js'
import { ArchNodeVM } from '../arch-node-vm.js'

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

// Add an ArchNodeVM to a doc with a specific Id.
function addVM(doc: DiagramDocument, id: string): ArchNodeVM {
    const vm = new ArchNodeVM()
    vm.Id = id
    doc.Nodes.Add(vm)
    return vm
}

test('attach binds ArchNodeVMs whose Id is an entity: derives Label + Descriptor; unknown VMs untouched', () => {
    const model = buildModel()
    const doc = new DiagramDocument()
    const web = addVM(doc, 'web')
    const ghost = addVM(doc, 'ghost')
    ghost.Label = 'freeform'
    const host = addVM(doc, 'host')

    new ArchDiagramBinding(doc, model).attach()

    // web and host map to entities, get their Label and Descriptor derived.
    expect(web.Label).toBe('web')     // id fallback (no label/name field)
    expect(host.Label).toBe('host')
    expect(web.Descriptor).toEqual(new ToolboxVisualDescriptor(TodlVisualResolverKey, 'Component'))
    expect(host.Descriptor).toEqual(new ToolboxVisualDescriptor(TodlVisualResolverKey, 'Node'))
    // ghost has no matching entity — left as-is.
    expect(ghost.Label).toBe('freeform')
})

test('a node whose entity references an icon-bearing term is keyed by that term id (resolver maps it via the index)', () => {
    // Base meta-model with a component->realisedBy->technology relationship and a
    // `<term>@icon` annotation node (the SOURCE shape: path only, no stamped key —
    // the arch project loads bases from source).
    const REF_MM = `namespace refmm {
      concept technology {}
      concept component { relationship realisedBy -> technology; }
      taxonomy Stack : represents technology { term azure {} }
      viewpoint CV : frames component
    }`
    const mmDoc = toJSON(load([{ uri: 'refmm.todl', text: REF_MM }]).model)
    mmDoc.nodes.push({ id: 'Stack.azure@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'resources/azure.svg' } })
    const baseRepo = new Repository(graphFromJSON(mmDoc))
    const file = { uri: 'refmodel.todl', text: 'namespace refmm { model Arch : refmm conforms CV { component c1 { realisedBy = Stack.azure; } } }' }
    const draft = ModelDraft.fromSources([baseRepo], [file], { namespace: 'refmm' })
    const model = new ArchModel(draft, new FakeStorage('fake://Arch'), 'refmm')

    const doc = new DiagramDocument()
    const c1 = addVM(doc, 'c1')
    new ArchDiagramBinding(doc, model).attach()

    expect(c1.Descriptor).toEqual(new ToolboxVisualDescriptor(TodlVisualResolverKey, 'Stack.azure'))
})

test('model label change re-syncs the bound VM; delete removes its VM', () => {
    const model = buildModel()
    const doc = new DiagramDocument()
    const web = addVM(doc, 'web')
    const host = addVM(doc, 'host')
    const binding = new ArchDiagramBinding(doc, model)
    binding.attach()
    void web
    void host

    model.setField('web', 'label', 'Web App')
    expect(web.Label).toBe('Web App')

    model.remove('host')
    const ids = doc.Nodes.ToArray().map((n) => n instanceof ArchNodeVM ? n.Id : undefined)
    expect(ids).toContain('web')
    expect(ids).not.toContain('host')
})

test('an in-place title edit commit persists to the entity label + saves; rescan re-derives it', async () => {
    const model = buildModel()
    const storage = new FakeStorage('fake://Arch')
    // Rebuild the ArchModel over a storage we can read back (buildModel makes its
    // own); reuse buildModel's draft by constructing directly here instead.
    const mmDoc = toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)
    const baseRepo = new Repository(graphFromJSON(mmDoc))
    const draft = ModelDraft.fromSources([baseRepo], [fileA, fileB], { namespace: 'archmm' })
    const model2 = new ArchModel(draft, storage, 'archmm')
    void model

    const doc = new DiagramDocument()
    const web = addVM(doc, 'web')
    new ArchDiagramBinding(doc, model2).attach()
    expect(web.Label).toBe('web')   // id fallback before edit

    // Edit the title in place and commit — the binding writes the entity's label.
    web.BeginEdit()
    web.EditingLabel = 'Web App'
    web.CommitEdit()

    // setField fired onChanged → rescan re-derived the label from the entity.
    expect(web.Label).toBe('Web App')
    // ...and the entity now carries it.
    expect(model2.entities().find((e) => e.id === 'web')?.field('label')).toBe('Web App')

    // save() round-trips it to the entity's home .todl file.
    await model2.save()
    expect(await storage.ReadText('model-a.todl')).toContain('Web App')
})

test('dispose stops further syncing', () => {
    const model = buildModel()
    const doc = new DiagramDocument()
    const web = addVM(doc, 'web')
    const binding = new ArchDiagramBinding(doc, model)
    binding.attach()
    model.setField('web', 'label', 'First')
    expect(web.Label).toBe('First')

    binding.dispose()
    model.setField('web', 'label', 'Second')
    expect(web.Label).toBe('First')   // no longer updating
})

test('freeform shape Figure (no entity) is left untouched by attach', () => {
    const model = buildModel()
    const doc = new DiagramDocument()
    // A raw shape Figure whose Id doesn't match any entity — binding must leave it alone.
    const shape = doc.CreateNode('rectangle', 0, 0)!
    shape.Id = 'freeform-shape'

    new ArchDiagramBinding(doc, model).attach()

    // The shape is not an ArchNodeVM and has no matching entity — it stays in the doc.
    expect(doc.Nodes.ToArray().some((n) => n instanceof Figure && n.Id === 'freeform-shape')).toBe(true)
})
