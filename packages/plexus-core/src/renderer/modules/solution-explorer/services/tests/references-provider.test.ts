import { describe, it, expect } from 'vitest'
import { NodeKey, NodeSeverity, type HierarchyItem, type HierarchyItemInit, type IRealizeContext, type ItemId } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { ProjectType, type SolutionMember } from '@pragmatic-tech-ai/todl'
import { type Disposable } from '@pragmatic-tech-ai/todl-runtime'
import { ReferencesProvider } from '../references-provider.js'
import { ReferenceNodeKey } from '../reference-node-key.js'
import { ReferenceResolution, type IReferenceView, type MemberReferencesView } from '../reference-view.js'
import type { BaseRef } from '../../../../projects/base-binding.js'

const tick = () => new Promise((r) => setTimeout(r, 10))

// A fake HierarchyItem: identity + the mutable presentation fields the provider writes.
class FakeItem
{
    public Caption: string
    public IconKey: string
    public Severity: NodeSeverity | undefined
    public Error: string | undefined
    public IsExpandable: boolean
    public ExtObject: unknown
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

// A fake IReferenceView returning a fixed view + fanning a fire() out to EVERY live
// subscriber (the provider subscribes once per realized item — root and each group — so a
// single-handler fake would silently drop the root's roll-up subscription).
function fakeView(view: MemberReferencesView | undefined): IReferenceView & { fire: (m: SolutionMember | undefined) => void }
{
    const handlers = new Set<(m: SolutionMember | undefined) => void>()
    return {
        fire: (m) => { for (const h of [...handlers]) h(m) },
        IsConsumer: () => view !== undefined,
        ReferencesViewFor: async () => view,
        AvailableReferencesFor: async () => [],
        AvailableVersionsFor: async () => [],
        AddMemberReference: async () => {},
        RemoveMemberReference: async () => {},
        SetMemberReferenceVersion: async () => {},
        OnReferencesViewChanged: (h) => { handlers.add(h); return { dispose() { handlers.delete(h) } } as Disposable },
    }
}

const member = {} as SolutionMember
const ref = (id: string, version: string): BaseRef => ({ id, version })
const viewOf = (metas: [BaseRef, ReferenceResolution][], offersLibraries = true, libs: [BaseRef, ReferenceResolution][] = []): MemberReferencesView => ({
    OffersLibraries: offersLibraries,
    MetaModels: metas.map(([Ref, Resolution]) => ({ Ref, Resolution })),
    Libraries: libs.map(([Ref, Resolution]) => ({ Ref, Resolution })),
})

// Realize the provider fully: subscribe root, then each realized group under its own context
// (one per group, so the group's live children — and their repin/removal deltas — are observed
// exactly as the owning Hierarchy would). Each group is realized once only.
async function realize(p: ReferencesProvider): Promise<{ root: FakeItem; rootCtx: FakeContext; groups: FakeItem[]; groupCtxs: FakeContext[]; leaves: FakeItem[] }>
{
    const root = new FakeItem(0 as ItemId, NodeKey.References)
    const rootCtx = new FakeContext()
    p.Realize(root as unknown as HierarchyItem, rootCtx)
    await tick()
    const groups = [...rootCtx.Children]
    const groupCtxs: FakeContext[] = []
    const leaves: FakeItem[] = []
    for (const g of groups)
    {
        const groupCtx = new FakeContext()
        p.Realize(g as unknown as HierarchyItem, groupCtx)
        await tick()
        groupCtxs.push(groupCtx)
        leaves.push(...groupCtx.Children)
    }
    return { root, rootCtx, groups, groupCtxs, leaves }
}

describe('ReferencesProvider', () =>
{
    it('emits Meta-models + Libraries groups then a leaf per declared ref, decorated', async () =>
    {
        const view = fakeView(viewOf(
            [[ref('core', '1.2.0'), ReferenceResolution.Published], [ref('w', '0.3.0'), ReferenceResolution.Unresolved]],
            true, [[ref('ui', '2.0.0'), ReferenceResolution.LiveWorkspace]]))
        const p = new ReferencesProvider(member, view)
        const { groups, leaves } = await realize(p)
        expect(groups.length).toBe(2)   // Meta-models + Libraries
        expect(leaves.map((n) => n.Caption).sort()).toEqual(['core@1.2.0', 'ui@2.0.0', 'w@0.3.0'])
        const unresolved = leaves.find((n) => n.Caption === 'w@0.3.0')!
        expect(unresolved.Severity).toBe(NodeSeverity.Warning)
        expect(unresolved.Error).toContain('Unresolved')
        expect(leaves.find((n) => n.Caption === 'core@1.2.0')!.Severity).toBe(NodeSeverity.Ok)
    })

    it('omits the Libraries group when OffersLibraries is false', async () =>
    {
        const p = new ReferencesProvider(member, fakeView(viewOf([[ref('core', '1.0.0'), ReferenceResolution.Published]], false)))
        const { groups } = await realize(p)
        expect(groups.length).toBe(1)
    })

    it('on a view change: a version repin mutates the SAME leaf in place; a removal drops it', async () =>
    {
        let current = viewOf([[ref('core', '1.0.0'), ReferenceResolution.Published], [ref('x', '1.0.0'), ReferenceResolution.Published]], false)
        const view = fakeView(current)
        ;(view as { ReferencesViewFor: () => Promise<MemberReferencesView | undefined> }).ReferencesViewFor = async () => current
        const p = new ReferencesProvider(member, view)
        const { groupCtxs } = await realize(p)
        const metaCtx = groupCtxs[0]!
        const coreLeaf = metaCtx.Children.find((c) => c.Caption === 'core@1.0.0')!

        current = viewOf([[ref('core', '1.2.0'), ReferenceResolution.Published]], false)   // core repinned, x removed
        view.fire(member)
        await tick()

        expect(coreLeaf.Caption).toBe('core@1.2.0')                             // same instance, repinned in place
        expect(metaCtx.Children).toContain(coreLeaf)
        expect(metaCtx.Children.some((c) => c.Caption === 'x@1.0.0')).toBe(false)   // x gone
    })

    it('a version repin refreshes the leaf canonical name; the old canonical no longer resolves', async () =>
    {
        let current = viewOf([[ref('core', '1.0.0'), ReferenceResolution.Published]], false)
        const view = fakeView(current)
        ;(view as { ReferencesViewFor: () => Promise<MemberReferencesView | undefined> }).ReferencesViewFor = async () => current
        const p = new ReferencesProvider(member, view)
        const { leaves } = await realize(p)
        const leaf = leaves[0]! as unknown as HierarchyItem
        const oldCanon = p.GetCanonicalName(leaf)
        expect(oldCanon).toContain('core@1.0.0')

        current = viewOf([[ref('core', '2.0.0'), ReferenceResolution.Published]], false)
        view.fire(member)
        await tick()

        expect(p.GetCanonicalName(leaf)).toContain('core@2.0.0')
        expect(p.ParseCanonicalName(oldCanon)).toBeUndefined()
        expect(p.ParseCanonicalName(p.GetCanonicalName(leaf))).toBe(leaf)
    })

    it('rolls up an unresolved leaf to a Warning on its group and the References root, clearing when resolved', async () =>
    {
        let current = viewOf([[ref('core', '1.0.0'), ReferenceResolution.Unresolved]], false)
        const view = fakeView(current)
        ;(view as { ReferencesViewFor: () => Promise<MemberReferencesView | undefined> }).ReferencesViewFor = async () => current
        const p = new ReferencesProvider(member, view)
        const { root, groups } = await realize(p)
        const metaGroup = groups[0]!
        expect(metaGroup.Severity).toBe(NodeSeverity.Warning)
        expect(root.Severity).toBe(NodeSeverity.Warning)

        current = viewOf([[ref('core', '1.0.0'), ReferenceResolution.Published]], false)
        view.fire(member)
        await tick()

        expect(metaGroup.Severity).toBe(NodeSeverity.Ok)
        expect(root.Severity).toBe(NodeSeverity.Ok)
    })

    it('a group header carries its kind + canonical slug; the root resolves to the realized root item', async () =>
    {
        const p = new ReferencesProvider(member, fakeView(viewOf([[ref('core', '1.0.0'), ReferenceResolution.Published]], false)))
        const { root, groups } = await realize(p)
        const metaGroup = groups[0]! as unknown as HierarchyItem
        expect(groups[0]!.Key).toBe(ReferenceNodeKey.Group)
        expect(groups[0]!.ExtObject).toBe(ProjectType.MetaModel)
        expect(p.GetCanonicalName(metaGroup)).toBe('references/meta-models')
        expect(p.ParseCanonicalName('references')).toBe(root as unknown as HierarchyItem)
    })
})
