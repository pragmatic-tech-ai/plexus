import { describe, it, expect } from 'vitest'
import { ServiceProvider, ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import {
    HierarchyModel, HierarchyContributorRegistry, HierarchyContributorDefinition,
    NodeContribution, NodeSeverity, HierarchyTreeVM,
    type IHierarchyContributor, type HierarchyNode, type HierarchyHost,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import type { IStorage, IPropertyBag } from '@pragmatic-tech-ai/todl-runtime'
import { Solution, RecordPropertyBag, BagScope, type IBagPersister } from '@pragmatic-tech-ai/todl'
import { SolutionTreeStateService } from '../solution-tree-state-service.js'

function fakeHost(): HierarchyHost
{
    return { Activate: () => {}, CommitRename: () => {}, Delete: () => {}, ActionsFor: () => [], CanDrop: () => false, Drop: () => {}, OnItemRemoved: () => {} }
}

// Minimal Global-scope persister: kind -> id -> live values map, create-on-write.
class FakeBags implements IBagPersister
{
    public readonly Scope = BagScope.Global
    private readonly live = new Map<string, Map<string, Map<string, unknown>>>()
    public Ids(kind: string): readonly string[] { return [...(this.live.get(kind)?.keys() ?? [])] }
    public Bag(kind: string, id: string): IPropertyBag { return new RecordPropertyBag(this.ensure(kind, id)) }
    public Create(kind: string, id: string): IPropertyBag { return this.Bag(kind, id) }
    public Delete(kind: string, id: string): void { this.live.get(kind)?.delete(id) }
    public Flush(): Promise<void> { return Promise.resolve() }
    private ensure(kind: string, id: string): Map<string, unknown>
    {
        let byId = this.live.get(kind); if (byId === undefined) { byId = new Map(); this.live.set(kind, byId) }
        let v = byId.get(id); if (v === undefined) { v = new Map(); byId.set(id, v) }
        return v
    }
}

// A solution tree with two keyed member roots (segments p1/p2), each expandable with one keyed child.
function makeTree(): { tree: HierarchyTreeVM }
{
    const sp = new ServiceProvider()
    const listing = new ServiceKey<IHierarchyContributor>('listing')
    sp.registerInstance(listing, { ParentKeys: ['solution'], Order: 0, Contribute: (): NodeContribution =>
        new NodeContribution([
            { Key: 'project', Caption: 'P1', IconKey: '', ExtObject: { a: 1 }, Severity: NodeSeverity.Ok, CanonicalSegment: 'p1', IsExpandable: true },
            { Key: 'project', Caption: 'P2', IconKey: '', ExtObject: { a: 2 }, Severity: NodeSeverity.Ok, CanonicalSegment: 'p2', IsExpandable: true },
        ]) } as IHierarchyContributor)
    const child = new ServiceKey<IHierarchyContributor>('child')
    sp.registerInstance(child, { ParentKeys: ['project'], Order: 0, Contribute: (p: HierarchyNode): NodeContribution =>
        new NodeContribution([{ Key: 'doc', Caption: 'c', IconKey: '', ExtObject: { of: (p.ExtObject as { a: number }).a }, Severity: NodeSeverity.Ok, CanonicalSegment: 'core.todl' }]) } as IHierarchyContributor)
    const registry = new HierarchyContributorRegistry(sp)
    for (const [k, pk] of [[listing, 'solution'], [child, 'project']] as const)
    {
        const d = new HierarchyContributorDefinition(); d.ParentKeys = [pk]; d.Contributor = k; d.Order = 0; registry.Register(d)
    }
    const model = new HierarchyModel(registry)
    const root = model.SeedRoot({ Key: 'solution', Caption: 'S', IconKey: '', ExtObject: {}, Severity: NodeSeverity.Ok })
    return { tree: new HierarchyTreeVM(model, root, fakeHost()) }
}

function titledSolution(): Solution { return new Solution('S', { Root: 'C:/sol' } as unknown as IStorage) }

describe('SolutionTreeStateService — persist', () =>
{
    it('writes the expanded + selection + anchor canonical names to the path-keyed bag', () =>
    {
        const { tree } = makeTree()
        const bags = new FakeBags()
        const solution = titledSolution()
        new SolutionTreeStateService(tree, solution, bags).Start()

        const p1 = tree.Roots.Get(0)!
        p1.Expand()                         // realizes p1's child; expansion change persists
        tree.SelectSingle(p1)               // selection change persists

        const bag = bags.Bag('solution-tree-state', 'C:/sol')
        expect(bag.GetValue('expanded')).toEqual(['solution/p1'])
        expect(bag.GetValue('selection')).toEqual(['solution/p1'])
        expect(bag.GetValue('anchor')).toBe('solution/p1')
    })

    it('an untitled solution never writes to the durable store', () =>
    {
        const { tree } = makeTree()
        const bags = new FakeBags()
        const untitled = new Solution('S')          // HasLocation === false
        new SolutionTreeStateService(tree, untitled, bags).Start()

        tree.Roots.Get(0)!.Expand()
        expect(bags.Ids('solution-tree-state')).toEqual([])   // nothing persisted
    })
})
