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

// Same store, but counts every durable SetValue so a test can assert that a guarded restore
// performs no writes at all. Seed writes are zeroed out by the test before Start().
class CountingBags extends FakeBags
{
    public writes = 0
    public override Bag(kind: string, id: string): IPropertyBag
    {
        const inner = super.Bag(kind, id)
        return new Proxy(inner, {
            get: (target, prop, receiver) =>
            {
                if (prop === 'SetValue')
                {
                    return (...args: unknown[]) => { this.writes++; return (target as unknown as { SetValue: (...a: unknown[]) => unknown }).SetValue(...args) }
                }
                const value = Reflect.get(target, prop, receiver)
                return typeof value === 'function' ? value.bind(target) : value
            },
        })
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

describe('SolutionTreeStateService — restore', () =>
{
    it('reactively restores expansion and selection, skipping stale names', () =>
    {
        const bags = new FakeBags()
        const seed = bags.Bag('solution-tree-state', 'C:/sol')
        seed.SetValue('expanded', ['solution/p1'])
        seed.SetValue('selection', ['solution/p2', 'solution/ghost'])   // ghost no longer exists
        seed.SetValue('anchor', 'solution/p2')

        const { tree } = makeTree()
        new SolutionTreeStateService(tree, titledSolution(), bags).Start()

        const [p1, p2] = [tree.Roots.Get(0)!, tree.Roots.Get(1)!]
        expect(p1.IsExpanded).toBe(true)                 // restored expansion
        expect(p2.IsExpanded).toBe(false)
        expect(tree.Selection.ToArray()).toEqual([p2])   // ghost skipped
        expect(tree.Anchor).toBe(p2)
    })

    it('builds cleanly when the bag is empty', () =>
    {
        const { tree } = makeTree()
        expect(() => new SolutionTreeStateService(tree, titledSolution(), new FakeBags()).Start()).not.toThrow()
        expect(tree.Roots.Get(0)!.IsExpanded).toBe(false)
    })
})

describe('SolutionTreeStateService — restore is one-shot (never fights the user)', () =>
{
    it('does not re-expand a subtree the user collapsed after the initial restore', () =>
    {
        const bags = new FakeBags()
        const seed = bags.Bag('solution-tree-state', 'C:/sol')
        seed.SetValue('expanded', ['solution/p1', 'solution/p1/core.todl'])
        seed.SetValue('selection', [])
        seed.SetValue('anchor', '')

        const { tree } = makeTree()
        new SolutionTreeStateService(tree, titledSolution(), bags).Start()

        const p1 = tree.Roots.Get(0)!
        expect(p1.IsExpanded).toBe(true)
        expect(p1.Children.ToArray()[0]!.IsExpanded).toBe(true)   // core.todl restored open

        p1.Collapse()
        p1.Expand()                                               // user re-expands p1 by hand

        const child = p1.Children.ToArray()[0]!                   // freshly re-realized core.todl
        expect(p1.IsExpanded).toBe(true)
        expect(child.IsExpanded).toBe(false)                      // NOT snapped back open by the stale seed
    })
})

describe('SolutionTreeStateService — bookkeeping does not leak across expand/collapse churn', () =>
{
    it('releases the disposers for VMs that leave the tree on collapse', () =>
    {
        const { tree } = makeTree()
        const svc = new SolutionTreeStateService(tree, titledSolution(), new FakeBags())
        svc.Start()

        const before = svc.TrackedVmCount
        const p1 = tree.Roots.Get(0)!
        p1.Expand()
        p1.Collapse()
        expect(svc.TrackedVmCount).toBe(before)                   // round-trip leaves nothing tracked behind
    })
})

describe('SolutionTreeStateService — restore stays fully guarded', () =>
{
    it('writes nothing to the durable store while restoring a nested keyed expansion', () =>
    {
        const bags = new CountingBags()
        const seed = bags.Bag('solution-tree-state', 'C:/sol')
        seed.SetValue('expanded', ['solution/p1', 'solution/p1/core.todl'])
        seed.SetValue('selection', [])
        seed.SetValue('anchor', '')
        bags.writes = 0                                           // ignore the seed writes

        const { tree } = makeTree()
        new SolutionTreeStateService(tree, titledSolution(), bags).Start()

        expect(tree.Roots.Get(0)!.IsExpanded).toBe(true)
        expect(tree.Roots.Get(0)!.Children.ToArray()[0]!.IsExpanded).toBe(true)
        expect(bags.writes).toBe(0)                               // no premature save during the guarded restore
    })
})
