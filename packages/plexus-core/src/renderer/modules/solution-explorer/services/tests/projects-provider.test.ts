import { describe, it, expect } from 'vitest'
import { Disposable, ServiceProvider, type IDisposable } from '@pragmatic-tech-ai/mural/runtime'
import {
    NodeKey, NodeSeverity, Hierarchy, HierarchyContributorRegistry,
    type HierarchyItem, type HierarchyItemInit, type HierarchyNodeSpec, type IRealizeContext, type IHierarchyProvider, type ItemId, type HierarchyHost,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { Solution, SolutionMemberStatus, type SolutionMember } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ProjectsProvider, ProjectsRootContributor, type IProjectContentSource, type IProjectReferencesSource } from '../projects-provider.js'

// A fake HierarchyItem: identity + the mutable presentation fields the provider writes in place
// on a Status flip, plus the ExtObject the init carries.
class FakeItem
{
    public Caption: string
    public IconKey: string
    public Severity: NodeSeverity | undefined
    public Error: string | undefined
    public IsExpandable: boolean
    public ExtObject: unknown
    public Parent: FakeItem | undefined
    public readonly CanonicalSegment: string | undefined

    constructor(public readonly Id: ItemId, public readonly Key: string, init?: HierarchyItemInit)
    {
        this.Caption = init?.Caption ?? ''
        this.IconKey = init?.IconKey ?? ''
        this.Severity = init?.Severity
        this.Error = init?.Error
        this.IsExpandable = init?.IsExpandable ?? false
        this.ExtObject = init?.ExtObject
        this.CanonicalSegment = init?.CanonicalSegment
    }
}

// A fake IRealizeContext that mints FakeItems and records the realized child set in order.
class FakeContext implements IRealizeContext
{
    public readonly Children: FakeItem[] = []
    private next = 1

    public NewItem(key: string, init?: HierarchyItemInit): HierarchyItem
    {
        return new FakeItem(this.next++ as ItemId, key, init) as unknown as HierarchyItem
    }

    public InsertChild(child: HierarchyItem): void
    {
        const item = child as unknown as FakeItem
        if (!this.Children.includes(item)) this.Children.push(item)
    }

    public RemoveChild(child: HierarchyItem): void
    {
        const at = this.Children.indexOf(child as unknown as FakeItem)
        if (at >= 0) this.Children.splice(at, 1)
    }
}

// A fake content source whose provider inserts a single 'FILE' leaf — the regression guard that
// a provider-owned project row STILL realizes its file-tree subtree (the mural owned path drops
// keyed ProviderContributions, so ProjectsProvider must delegate to this).
class FakeContent implements IProjectContentSource
{
    public readonly released: SolutionMember[] = []
    public readonly realized: HierarchyItem[] = []

    public ContentProviderFor(_member: SolutionMember): IHierarchyProvider
    {
        const realized = this.realized
        return {
            ProviderId: 'fake.content',
            Realize(item: HierarchyItem, ctx: IRealizeContext): IDisposable
            {
                realized.push(item)
                ctx.InsertChild(ctx.NewItem('file', { Caption: 'FILE', ExtObject: { f: 1 } }))
                return Disposable.None
            },
            Integrate() {},
            GetCanonicalName() { return '' },
            ParseCanonicalName() { return undefined },
            CanAccept() { return false },
        }
    }

    public Release(member: SolutionMember): void { this.released.push(member) }
}

class FakeRefs implements IProjectReferencesSource
{
    public readonly released: SolutionMember[] = []

    constructor(private readonly consumer: boolean) {}

    public ReferenceRootNode(_member: SolutionMember): HierarchyNodeSpec | undefined
    {
        if (!this.consumer) return undefined
        return { Key: NodeKey.References, Caption: 'References', IconKey: 'references', ExtObject: { refs: 1 }, Severity: NodeSeverity.Ok, IsExpandable: true, CanonicalSegment: 'references' }
    }

    public ReferenceProviderFor(_member: SolutionMember): IHierarchyProvider | undefined { return undefined }
    public Release(member: SolutionMember): void { this.released.push(member) }
}

function rootItem(): HierarchyItem
{
    return new FakeItem(0 as ItemId, NodeKey.Solution) as unknown as HierarchyItem
}

function resolved(sol: Solution, path: string): SolutionMember
{
    const m = sol.AddMember(path, 'architecture')
    m.Status = SolutionMemberStatus.Resolved
    m.Storage = new FakeStorage(path)
    return m
}

describe('ProjectsProvider', () =>
{
    it('seeds one project row per member under the Solution root, keyed NodeKey.Project', () =>
    {
        const sol = new Solution('S')
        const a = resolved(sol, './a')
        const b = resolved(sol, './b')
        const p = new ProjectsProvider(sol, new FakeContent(), new FakeRefs(true))
        const ctx = new FakeContext()
        p.Realize(rootItem(), ctx)
        expect(ctx.Children.map((c) => c.ExtObject)).toEqual([a, b])
        expect(ctx.Children.every((c) => c.Key === NodeKey.Project)).toBe(true)
        expect(ctx.Children.map((c) => c.CanonicalSegment)).toEqual([a.Ref.path, b.Ref.path])
    })

    it('adding a member pushes a new row (InsertChild)', () =>
    {
        const sol = new Solution('S')
        resolved(sol, './a')
        const p = new ProjectsProvider(sol, new FakeContent(), new FakeRefs(true))
        const ctx = new FakeContext()
        p.Realize(rootItem(), ctx)
        expect(ctx.Children.length).toBe(1)
        const c = resolved(sol, './c')
        expect(ctx.Children.length).toBe(2)
        expect(ctx.Children[1]!.ExtObject).toBe(c)
    })

    it('removing a member (Remove from Solution) drops its row and releases its stores', () =>
    {
        const sol = new Solution('S')
        const a = resolved(sol, './a')
        const b = resolved(sol, './b')
        const content = new FakeContent()
        const refs = new FakeRefs(true)
        const p = new ProjectsProvider(sol, content, refs)
        const ctx = new FakeContext()
        p.Realize(rootItem(), ctx)
        expect(ctx.Children.length).toBe(2)
        sol.RemoveMember(b)
        expect(ctx.Children.map((c) => c.ExtObject)).toEqual([a])
        expect(content.released).toEqual([b])
        expect(refs.released).toEqual([b])
    })

    it('a Status flip mutates the SAME row in place (severity + expandability)', () =>
    {
        const sol = new Solution('S')
        const a = resolved(sol, './a')
        const p = new ProjectsProvider(sol, new FakeContent(), new FakeRefs(true))
        const ctx = new FakeContext()
        p.Realize(rootItem(), ctx)
        const row = ctx.Children[0]!
        expect(row.Severity).toBe(NodeSeverity.Ok)
        expect(row.IsExpandable).toBe(true)
        a.Error = 'boom'
        a.Status = SolutionMemberStatus.LoadFailed
        expect(ctx.Children[0]).toBe(row)             // same instance
        expect(row.Severity).toBe(NodeSeverity.Error) // repainted in place
        expect(row.Error).toBe('boom')
        expect(row.IsExpandable).toBe(false)
    })

    it('a project row realizes its References node then delegates its file-content subtree', () =>
    {
        const sol = new Solution('S')
        resolved(sol, './a')
        const content = new FakeContent()
        const p = new ProjectsProvider(sol, content, new FakeRefs(true))
        const rootCtx = new FakeContext()
        p.Realize(rootItem(), rootCtx)
        const row = rootCtx.Children[0]! as unknown as HierarchyItem
        const rowCtx = new FakeContext()
        p.Realize(row, rowCtx)
        expect(rowCtx.Children.map((c) => c.Caption)).toEqual(['References', 'FILE'])
        expect(content.realized).toContain(row)
    })

    it('a non-consumer project row delegates content but mints no References node', () =>
    {
        const sol = new Solution('S')
        resolved(sol, './m')
        const p = new ProjectsProvider(sol, new FakeContent(), new FakeRefs(false))
        const rootCtx = new FakeContext()
        p.Realize(rootItem(), rootCtx)
        const row = rootCtx.Children[0]! as unknown as HierarchyItem
        const rowCtx = new FakeContext()
        p.Realize(row, rowCtx)
        expect(rowCtx.Children.map((c) => c.Caption)).toEqual(['FILE'])
    })

    // Regression guard: through mural's REAL owned-realize path, an OWNED project row must still
    // realize its subtree. (A naive provider that only owns the rows yields an empty row here,
    // because the owned path drops keyed ProviderContributions — ProjectsProvider must delegate.)
    it('realizes the project-row subtree through the real Hierarchy owned path', () =>
    {
        const sol = new Solution('S')
        resolved(sol, './a')
        const container = new ServiceProvider()
        const registry = new HierarchyContributorRegistry(container)
        container.registerInstance(HierarchyContributorRegistry.Key, registry)
        registry.RegisterInstance(new ProjectsRootContributor(sol, new FakeContent(), new FakeRefs(true)))
        const host = {
            Activate() {}, CommitRename() {}, OnItemRemoved() {}, Delete() {},
            CanDrop() { return false }, Drop() {},
        } as unknown as HierarchyHost
        const h = new Hierarchy(registry, host)
        h.SeedRoot(NodeKey.Solution, { IsExpandable: true })
        const row = h.Roots.Get(0)!
        expect(row.Key).toBe(NodeKey.Project)
        row.OnExpand()
        expect(row.Children.ToArray().map((c) => c.Caption)).toEqual(['References', 'FILE'])
        h.dispose()
    })
})
