import { describe, it, expect } from 'vitest'
import {
    HierarchyItemId, ChildAdded, HierarchyPropertyId, NodeSeverity,
    type HierarchyChange, type IHierarchyProvider,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { ProjectBranchesProvider } from '../project-branches-provider.js'

// A fake file provider: on root it emits one file child; records the ids it is asked about.
function fakeFiles()
{
    const asked: HierarchyItemId[] = []
    const fileChild = HierarchyItemId.Mint()
    const provider: IHierarchyProvider = {
        ProviderId: 'files',
        ObserveChildren: (node, sink) => { asked.push(node); sink(new ChildAdded(fileChild, { Key: 'file', Caption: 'a.todl', IconKey: 'file', ExtObject: {}, Severity: NodeSeverity.Ok })); return () => {} },
        GetProperty: (id, p) => { asked.push(id); return p === HierarchyPropertyId.Caption ? 'a.todl' : undefined },
        GetCanonicalName: () => 'a.todl',
        ParseCanonicalName: () => HierarchyItemId.Nil,
        CanAccept: () => true,
    }
    return { provider, asked, fileChild }
}

// A fake refs provider standing in for ReferencesProvider (Owns + ReferencesRootId + IHierarchyProvider).
function fakeRefs()
{
    const root = HierarchyItemId.Mint()
    const owned = new Set<HierarchyItemId>([root])
    let disposed = false
    return {
        root, owned, get disposed() { return disposed },
        ReferencesRootId: () => root,
        ReferencesRootNode: () => ({ Key: 'references', Caption: 'References', IconKey: 'references', ExtObject: {}, Severity: NodeSeverity.Ok, IsExpandable: true }),
        Owns: (id: HierarchyItemId) => owned.has(id),
        ProviderId: 'refs',
        ObserveChildren: (_n: HierarchyItemId, _s: (c: HierarchyChange) => void) => () => {},
        GetProperty: (_id: HierarchyItemId, p: HierarchyPropertyId) => p === HierarchyPropertyId.Caption ? 'References' : undefined,
        GetCanonicalName: () => 'references',
        ParseCanonicalName: () => HierarchyItemId.Nil,
        CanAccept: () => false,
        dispose: () => { disposed = true },
    }
}

describe('ProjectBranchesProvider', () =>
{
    it('emits References as child[0] on the root, then forwards file children', () =>
    {
        const files = fakeFiles()
        const refs = fakeRefs()
        const p = new ProjectBranchesProvider(files.provider, refs as never)
        const added: HierarchyItemId[] = []
        p.ObserveChildren(HierarchyItemId.Root, (c) => { if (c instanceof ChildAdded) added.push(c.Id) })
        expect(added[0]).toBe(refs.root)         // References first
        expect(added).toContain(files.fileChild) // then files
    })

    it('dispatches GetProperty to refs for refs-owned ids and to files otherwise', () =>
    {
        const files = fakeFiles()
        const refs = fakeRefs()
        const p = new ProjectBranchesProvider(files.provider, refs as never)
        expect(p.GetProperty(refs.root, HierarchyPropertyId.Caption)).toBe('References')
        const someFileId = HierarchyItemId.Mint()
        p.GetProperty(someFileId, HierarchyPropertyId.Caption)
        expect(files.asked).toContain(someFileId)
    })

    it('dispose disposes the refs provider', () =>
    {
        const refs = fakeRefs()
        const p = new ProjectBranchesProvider(fakeFiles().provider, refs as never)
        p.dispose()
        expect(refs.disposed).toBe(true)
    })
})
