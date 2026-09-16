import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { DiagramDocument, Figure } from '@pragmatic-tech-ai/mural/framework'
import type { Diagram } from '@pragmatic-tech-ai/mural/framework'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBinding } from '../arch-diagram-binding.js'
import { ArchNodeVM } from '../arch-node-vm.js'

// component `comp` sits in location `loc` via the default `in` containment ref.
const MM = `namespace archmm {
  concept location {}
  concept component { relationship in -> location; }
  viewpoint V : frames location, component
}`
const file = { uri: 'model.todl', text: `namespace archmm {
  model Arch : archmm conforms V { location loc {} component comp { in = loc; } }
}` }

function buildModel(): ArchModel {
    const mmDoc = toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)
    const baseRepo = new Repository(graphFromJSON(mmDoc))
    const draft = ModelDraft.fromSources([baseRepo], [file], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
}

// A structural fake of the mounted Diagram view: it realizes each VM into a real
// Figure (so `fig instanceof Figure` holds) whose Id mirrors the VM, and its
// ContainerPlacement records reparent calls, mutating ContainerParent to model
// the nesting. Nesting mechanics themselves are mural's (tested there); here we
// verify the binding drives reparent with the right (figure, parentId).
function fakeView(): { view: Diagram; reparents: Array<{ id: string | undefined; parentId: string | undefined }>; figFor: (id: string) => Figure } {
    const figs = new Map<string, Figure>()
    const figFor = (id: string): Figure => {
        let f = figs.get(id)
        if (f === undefined) { f = new Figure(); f.Id = id; figs.set(id, f) }
        return f
    }
    const reparents: Array<{ id: string | undefined; parentId: string | undefined }> = []
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
        AddNodeReparentedListener: () => {},
        RemoveNodeReparentedListener: () => {},
    } as unknown as Diagram
    return { view, reparents, figFor }
}

// A doc whose ActiveView is a test-supplied fake, bypassing the real DP (setting
// the DP wires a view-mirror the fake can't satisfy).
class TestDoc extends DiagramDocument {
    public fakeView: Diagram | undefined
    public override get ActiveView(): Diagram | undefined { return this.fakeView }
    public override set ActiveView(_v: Diagram | undefined) { /* driven via fakeView in tests */ }
}

function addVM(doc: DiagramDocument, id: string): ArchNodeVM {
    const vm = new ArchNodeVM()
    vm.Id = id
    doc.Nodes.Add(vm)
    return vm
}

test('an `in` ref nests the child Figure into its container and draws no connector', () => {
    const model = buildModel()
    const doc = new TestDoc()
    addVM(doc, 'loc')
    addVM(doc, 'comp')
    const { view, reparents, figFor } = fakeView()
    doc.fakeView = view

    new ArchDiagramBinding(doc, model).attach()

    // comp's Figure got re-parented into loc; loc stays at root (no spurious call).
    expect(reparents).toContainEqual({ id: 'comp', parentId: 'loc' })
    expect(reparents.some((r) => r.id === 'loc')).toBe(false)
    expect((figFor('comp') as unknown as { ContainerParent?: Figure }).ContainerParent?.Id).toBe('loc')

    // The `in` ref nests — it does NOT project as a connector.
    expect(doc.Connectors.ToArray().length).toBe(0)
})
