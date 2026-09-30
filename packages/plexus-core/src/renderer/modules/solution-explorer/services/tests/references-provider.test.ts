import { describe, it, expect } from 'vitest'
import {
    HierarchyItemId, ChildAdded, NodeSeverity,
    HierarchyPropertyId, type HierarchyChange,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { ProjectType, type SolutionMember } from '@pragmatic-tech-ai/todl'
import { type Disposable } from '@pragmatic-tech-ai/todl-runtime'
import { ReferencesProvider } from '../references-provider.js'
import { ReferenceNodeKey } from '../reference-node-key.js'
import {
    ReferenceResolution, type IReferenceView, type MemberReferencesView,
} from '../reference-view.js'
import type { BaseRef } from '../../../../projects/base-binding.js'

const tick = () => new Promise((r) => setTimeout(r, 10))

// A fake IReferenceView returning a fixed view + capturing the change handler.
function fakeView(view: MemberReferencesView | undefined): IReferenceView & { fire: (m: SolutionMember | undefined) => void }
{
    let handler: ((m: SolutionMember | undefined) => void) | undefined
    return {
        fire: (m) => handler?.(m),
        IsConsumer: () => view !== undefined,
        ReferencesViewFor: async () => view,
        AvailableReferencesFor: async () => [],
        AvailableVersionsFor: async () => [],
        AddMemberReference: async () => {},
        RemoveMemberReference: async () => {},
        SetMemberReferenceVersion: async () => {},
        OnReferencesViewChanged: (h) => { handler = h; return { dispose() { handler = undefined } } as Disposable },
    }
}

const member = {} as SolutionMember
const ref = (id: string, version: string): BaseRef => ({ id, version })
const viewOf = (metas: [BaseRef, ReferenceResolution][], offersLibraries = true, libs: [BaseRef, ReferenceResolution][] = []): MemberReferencesView => ({
    OffersLibraries: offersLibraries,
    MetaModels: metas.map(([Ref, Resolution]) => ({ Ref, Resolution })),
    Libraries: libs.map(([Ref, Resolution]) => ({ Ref, Resolution })),
})

// Realize the provider fully: subscribe root, then each group.
async function realize(p: ReferencesProvider)
{
    const changes: { parent: HierarchyItemId; c: HierarchyChange }[] = []
    const record = (parent: HierarchyItemId) => (c: HierarchyChange) => changes.push({ parent, c })
    p.ObserveChildren(p.ReferencesRootId(), record(p.ReferencesRootId()))
    await tick()
    const groups = changes.filter((x) => x.c instanceof ChildAdded).map((x) => (x.c as ChildAdded).Id)
    for (const g of groups) p.ObserveChildren(g, record(g))
    await tick()
    return { changes, groups }
}

describe('ReferencesProvider', () =>
{
    it('emits Meta-models + Libraries groups then a leaf per declared ref, decorated', async () =>
    {
        const view = fakeView(viewOf(
            [[ref('core', '1.2.0'), ReferenceResolution.Published], [ref('w', '0.3.0'), ReferenceResolution.Unresolved]],
            true, [[ref('ui', '2.0.0'), ReferenceResolution.LiveWorkspace]]))
        const p = new ReferencesProvider(member, view)
        const { changes, groups } = await realize(p)
        expect(groups.length).toBe(2)   // Meta-models + Libraries
        const leaves = changes.filter((x) => x.c instanceof ChildAdded && (x.c as ChildAdded).Node.Key === ReferenceNodeKey.Leaf)
            .map((x) => (x.c as ChildAdded).Node)
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

    it('on OnReferencesViewChanged re-fetch: a version repin is a ChildUpdated (same id), a removal is ChildRemoved', async () =>
    {
        let current = viewOf([[ref('core', '1.0.0'), ReferenceResolution.Published], [ref('x', '1.0.0'), ReferenceResolution.Published]])
        const view = fakeView(current)
        // Re-point ReferencesViewFor at a mutable `current`.
        ;(view as { ReferencesViewFor: () => Promise<MemberReferencesView | undefined> }).ReferencesViewFor = async () => current
        const p = new ReferencesProvider(member, view)
        const { changes, groups } = await realize(p)
        const metaGroup = groups[0]!
        changes.length = 0
        current = viewOf([[ref('core', '1.2.0'), ReferenceResolution.Published]])   // core repinned, x removed
        view.fire(member)
        await tick()
        const kinds = changes.filter((x) => x.parent === metaGroup).map((x) => x.c.constructor.name)
        expect(kinds).toContain('ChildUpdated')   // core@1.0.0 -> core@1.2.0, same id
        expect(kinds).toContain('ChildRemoved')   // x gone
    })

    it('GetProperty on the References root reports Caption/Key/expandable', () =>
    {
        const p = new ReferencesProvider(member, fakeView(viewOf([])))
        const root = p.ReferencesRootId()
        expect(p.GetProperty(root, HierarchyPropertyId.Caption)).toBe('References')
        expect(p.GetProperty(root, HierarchyPropertyId.IsExpandable)).toBe(true)
    })
})
