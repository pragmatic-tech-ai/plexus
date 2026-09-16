import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { DiagramDocument, Figure } from '@pragmatic-tech-ai/mural/framework'
import type { Diagram } from '@pragmatic-tech-ai/mural/framework'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBinding } from '../arch-diagram-binding.js'
import { ArchNodeVM } from '../arch-node-vm.js'

interface ReparentArgs { Node: { Id: string | undefined }; OldParentId: string | undefined; NewParentId: string | undefined }

// Triplet: component --in--> location; technology --in--> component. A component
// may nest in a location but NOT in a technology (no relationship).
const MM = `namespace archmm {
  concept location {}
  concept component { relationship in -> location; }
  concept technology { relationship in -> component; }
  viewpoint V : frames location, component, technology
}`
// No `in` refs to start — the write-back creates them.
const file = { uri: 'model.todl', text: `namespace archmm {
  model Arch : archmm conforms V { location loc {} component comp {} technology tech {} }
}` }

function buildModel(): ArchModel {
    const mmDoc = toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)
    const baseRepo = new Repository(graphFromJSON(mmDoc))
    const draft = ModelDraft.fromSources([baseRepo], [file], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
}

class TestDoc extends DiagramDocument {
    public fakeView: Diagram | undefined
    public override get ActiveView(): Diagram | undefined { return this.fakeView }
    public override set ActiveView(_v: Diagram | undefined) { /* driven via fakeView */ }
}

function fakeView(): { view: Diagram; fire: (a: ReparentArgs) => void; snapBacks: string[] } {
    const figs = new Map<string, Figure>()
    const figFor = (id: string): Figure => {
        let f = figs.get(id)
        if (f === undefined) { f = new Figure(); f.Id = id; figs.set(id, f) }
        return f
    }
    const listeners: Array<(a: ReparentArgs) => void> = []
    const snapBacks: string[] = []   // nodes reparented to undefined by the binding (rejections / un-nests)
    const view = {
        Generator: { ContainerFromItem: (vm: { Id?: string }) => figFor(vm.Id!) },
        ContainerPlacement: {
            placeAll: () => {},
            reparent: (fig: Figure, parentId: string | undefined) => {
                if (parentId === undefined && fig.Id !== undefined) snapBacks.push(fig.Id)
                ;(fig as unknown as { ContainerParent: Figure | undefined }).ContainerParent =
                    parentId === undefined ? undefined : figFor(parentId)
            },
        },
        AddConnectorCreatedListener: () => {},
        RemoveConnectorCreatedListener: () => {},
        AddDeleteRequestedListener: () => {},
        RemoveDeleteRequestedListener: () => {},
        AddNodeReparentedListener: (l: (a: ReparentArgs) => void) => { listeners.push(l) },
        RemoveNodeReparentedListener: (l: (a: ReparentArgs) => void) => {
            const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1)
        },
    } as unknown as Diagram
    return { view, fire: (a) => { for (const l of [...listeners]) l(a) }, snapBacks }
}

// A spy DialogService: records each Show() so tests can assert the rejection modal.
function fakeDialogs(): { dialogs: unknown; shows: Array<{ Title?: string }> } {
    const shows: Array<{ Title?: string }> = []
    const dialogs = { Show: (o: { Title?: string }) => { shows.push(o); return Promise.resolve(undefined) }, Close: () => {} }
    return { dialogs, shows }
}

function setup(): { model: ArchModel; doc: TestDoc; fire: (a: ReparentArgs) => void; snapBacks: string[]; shows: Array<{ Title?: string }>; refsIn: (id: string) => string[] } {
    const model = buildModel()
    const doc = new TestDoc()
    for (const id of ['loc', 'comp', 'tech']) { const vm = new ArchNodeVM(); vm.Id = id; doc.Nodes.Add(vm) }
    const { view, fire, snapBacks } = fakeView()
    doc.fakeView = view
    const { dialogs, shows } = fakeDialogs()
    new ArchDiagramBinding(doc, model, undefined, undefined, undefined, dialogs as never).attach()
    const refsIn = (id: string): string[] => model.entities().find((e) => e.id === id)!.refs('in').map((e) => e.id)
    return { model, doc, fire, snapBacks, shows, refsIn }
}

test('nesting a component into a location writes the `in` ref', () => {
    const { fire, refsIn } = setup()
    fire({ Node: { Id: 'comp' }, OldParentId: undefined, NewParentId: 'loc' })
    expect(refsIn('comp')).toEqual(['loc'])
})

test('un-nesting removes the `in` ref', () => {
    const { fire, refsIn } = setup()
    fire({ Node: { Id: 'comp' }, OldParentId: undefined, NewParentId: 'loc' })
    expect(refsIn('comp')).toEqual(['loc'])
    fire({ Node: { Id: 'comp' }, OldParentId: 'loc', NewParentId: undefined })
    expect(refsIn('comp')).toEqual([])
})

test('an illegal nesting (location into technology) is rejected: no ref, node snapped back', () => {
    const { fire, refsIn, snapBacks } = setup()
    fire({ Node: { Id: 'loc' }, OldParentId: undefined, NewParentId: 'tech' })
    expect(refsIn('loc')).toEqual([])          // no ref written
    expect(snapBacks).toContain('loc')          // un-nested (snapped back)
})

test('an illegal drag-in shows the rejection modal (same modal as the drop path)', () => {
    const { fire, shows } = setup()
    fire({ Node: { Id: 'loc' }, OldParentId: undefined, NewParentId: 'tech' })
    expect(shows.length).toBe(1)
    expect(shows[0]!.Title).toBe('Cannot nest here')
})

test('a legal drag-in shows no modal', () => {
    const { fire, shows } = setup()
    fire({ Node: { Id: 'comp' }, OldParentId: undefined, NewParentId: 'loc' })
    expect(shows.length).toBe(0)
})

test('dragging a component into a LIBRARY (non-own) location writes the `in` ref', () => {
    // Base repo carries a location INSTANCE (libloc) — like an imported library
    // location. It is NOT an own instance of the project model, so the parent must
    // resolve via repo.entity (resolveEntity), and the write lands on the own child.
    const baseGraph = toJSON(load([
        { uri: 'archmm.todl', text: MM },
        { uri: 'lib.todl', text: `namespace archmm { model Lib : archmm conforms V { location libloc {} } }` },
    ]).model)
    const baseRepo = new Repository(graphFromJSON(baseGraph))
    const projectFile = { uri: 'model.todl', text: `namespace archmm { model Arch : archmm conforms V { component comp {} } }` }
    const draft = ModelDraft.fromSources([baseRepo], [projectFile], { namespace: 'archmm' })
    const model = new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')

    // libloc is a repo entity but NOT an own instance.
    expect(model.entities().some((e) => e.id === 'libloc')).toBe(false)
    expect(model.repository().has('libloc')).toBe(true)

    const doc = new TestDoc()
    for (const id of ['comp', 'libloc']) { const vm = new ArchNodeVM(); vm.Id = id; doc.Nodes.Add(vm) }
    const { view, fire } = fakeView()
    doc.fakeView = view
    new ArchDiagramBinding(doc, model, undefined, undefined, undefined, fakeDialogs().dialogs as never).attach()

    fire({ Node: { Id: 'comp' }, OldParentId: undefined, NewParentId: 'libloc' })
    const comp = model.entities().find((e) => e.id === 'comp')!
    expect(comp.refs('in').map((e) => e.id)).toEqual(['libloc'])
})

test('a reparent of a node with no backing entity is ignored (visual-only grouping)', () => {
    const { fire, snapBacks } = setup()
    fire({ Node: { Id: 'ghost' }, OldParentId: undefined, NewParentId: 'loc' })
    expect(snapBacks).not.toContain('ghost')   // no rejection, no model write — just left alone
})

test('nesting a model node into a generic (non-entity) container is accepted visually, no ref, no snap-back', () => {
    const { fire, refsIn, snapBacks } = setup()
    // 'container:1' is a generic container Figure (no backing entity).
    fire({ Node: { Id: 'comp' }, OldParentId: undefined, NewParentId: 'container:1' })
    expect(refsIn('comp')).toEqual([])            // no model ref written (generic = visual-only)
    expect(snapBacks).not.toContain('comp')       // accepted, not rejected
})
