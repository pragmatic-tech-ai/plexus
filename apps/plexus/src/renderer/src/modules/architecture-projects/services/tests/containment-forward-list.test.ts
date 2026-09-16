import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { DiagramDocument, Figure } from '@pragmatic-tech-ai/mural/framework'
import type { Diagram } from '@pragmatic-tech-ai/mural/framework'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBinding } from '../arch-diagram-binding.js'
import { ArchNodeVM } from '../arch-node-vm.js'

// A `block` is a container with TWO membership channels: the child-side
// @containment up-ref (`component.in_block`) and its own forward list
// (`block.components`). `listed` is a member ONLY via the list (no in_block) — the
// case that left blocks looking empty on the diagram. `command_bus`/`event_stream`
// exercise the up-ref channel for the write-back symmetry test.
const MM = `namespace archmm {
  concept location {}
  concept component {
    relationship in -> location?;
    relationship in_block -> block? { annotate containment {} }
  }
  concept block {
    annotate has_children {}
    relationship in -> location;
    components : component[];
  }
  viewpoint V : frames location, component, block
}`
const file = { uri: 'model.todl', text: `namespace archmm {
  model Arch : archmm conforms V {
    location azure {}
    block chat_surface { in = azure; components = [listed]; }
    component listed {}
    block command_bus { in = azure; }
    component upref { in_block = command_bus; }
  }
}` }

function buildModel(): ArchModel {
    const mmDoc = toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)
    const baseRepo = new Repository(graphFromJSON(mmDoc))
    const draft = ModelDraft.fromSources([baseRepo], [file], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
}

// A fake mounted view that realizes each VM into a Figure, records reparents, and
// captures the NodeReparented listener so a test can fire a drag write-back.
function fakeView(): {
    view: Diagram
    reparents: Array<{ id: string | undefined; parentId: string | undefined }>
    fireReparent: (args: { Node: { Id?: string }; OldParentId?: string; NewParentId?: string }) => void
} {
    const figs = new Map<string, Figure>()
    const figFor = (id: string): Figure => {
        let f = figs.get(id)
        if (f === undefined) { f = new Figure(); f.Id = id; figs.set(id, f) }
        return f
    }
    const reparents: Array<{ id: string | undefined; parentId: string | undefined }> = []
    let onReparent: ((args: unknown) => void) | undefined
    const view = {
        Generator: { ContainerFromItem: (vm: { Id?: string }) => figFor(vm.Id!) },
        ContainerPlacement: {
            placeAll: () => {},
            reparent: (fig: Figure, parentId: string | undefined) => {
                reparents.push({ id: fig.Id, parentId })
                ;(fig as unknown as { ContainerParent: Figure | undefined }).ContainerParent =
                    parentId === undefined ? undefined : figFor(parentId)
            },
        },
        AddConnectorCreatedListener: () => {},
        RemoveConnectorCreatedListener: () => {},
        AddDeleteRequestedListener: () => {},
        RemoveDeleteRequestedListener: () => {},
        AddNodeReparentedListener: (l: (args: unknown) => void) => { onReparent = l },
        RemoveNodeReparentedListener: () => { onReparent = undefined },
    } as unknown as Diagram
    return { view, reparents, fireReparent: (args) => onReparent?.(args) }
}

class TestDoc extends DiagramDocument {
    public fakeView: Diagram | undefined
    public override get ActiveView(): Diagram | undefined { return this.fakeView }
    public override set ActiveView(_v: Diagram | undefined) { /* driven via fakeView */ }
}

function addVM(doc: DiagramDocument, id: string): void {
    const vm = new ArchNodeVM()
    vm.Id = id
    doc.Nodes.Add(vm)
}

test('a component listed only in a block`s `components` field nests into that block', () => {
    const model = buildModel()
    const doc = new TestDoc()
    addVM(doc, 'chat_surface')
    addVM(doc, 'listed')
    const { view, reparents } = fakeView()
    doc.fakeView = view

    new ArchDiagramBinding(doc, model).attach()

    // `listed` carries no in_block — it nests purely from chat_surface.components.
    expect(reparents).toContainEqual({ id: 'listed', parentId: 'chat_surface' })
    expect(reparents.some((r) => r.id === 'chat_surface')).toBe(false)
})

test('un-nesting a list-only member strips it from the block`s `components` (drag-out sticks)', () => {
    const model = buildModel()
    const doc = new TestDoc()
    addVM(doc, 'chat_surface')
    addVM(doc, 'listed')
    const { view, fireReparent } = fakeView()
    doc.fakeView = view
    new ArchDiagramBinding(doc, model).attach()

    fireReparent({ Node: { Id: 'listed' }, OldParentId: 'chat_surface', NewParentId: undefined })

    const block = model.entities().find((e) => e.id === 'chat_surface')!
    expect(block.refs('components').map((e) => e.id)).not.toContain('listed')
})

test('un-nesting an in_block member strips the child`s in_block up-ref', () => {
    const model = buildModel()
    const doc = new TestDoc()
    addVM(doc, 'command_bus')
    addVM(doc, 'upref')
    const { view, fireReparent } = fakeView()
    doc.fakeView = view
    new ArchDiagramBinding(doc, model).attach()

    fireReparent({ Node: { Id: 'upref' }, OldParentId: 'command_bus', NewParentId: undefined })

    const child = model.entities().find((e) => e.id === 'upref')!
    expect(child.refs('in_block').map((e) => e.id)).not.toContain('command_bus')
})
