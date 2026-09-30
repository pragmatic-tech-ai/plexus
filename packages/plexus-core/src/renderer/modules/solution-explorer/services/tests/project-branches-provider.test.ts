import { describe, it, expect } from 'vitest'
import {
    HierarchyItemId, ChildAdded, HierarchyPropertyId, NodeSeverity,
    type HierarchyChange, type IHierarchyProvider,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { ProjectBranchesProvider, type LeadingBranch } from '../project-branches-provider.js'

// A fake file provider: on root it emits one file child async (like the real content
// provider, so the composite's microtask-scheduled leading roots land first).
function fakeFiles()
{
    const asked: HierarchyItemId[] = []
    const fileChild = HierarchyItemId.Mint()
    const provider: IHierarchyProvider = {
        ProviderId: 'files',
        ObserveChildren: (node, sink) => { asked.push(node); queueMicrotask(() => sink(new ChildAdded(fileChild, { Key: 'file', Caption: 'a.todl', IconKey: 'file', ExtObject: {}, Severity: NodeSeverity.Ok }))); return () => {} },
        GetProperty: (id, p) => { asked.push(id); return p === HierarchyPropertyId.Caption ? 'a.todl' : undefined },
        GetCanonicalName: () => 'a.todl',
        ParseCanonicalName: () => HierarchyItemId.Nil,
        CanAccept: () => true,
    }
    return { provider, asked, fileChild }
}

// A fake leading branch (a single row) recording disposal.
function fakeLeading(tag: string): LeadingBranch & { disposed: boolean; root: HierarchyItemId }
{
    const root = HierarchyItemId.Mint()
    let disposed = false
    return {
        root, get disposed() { return disposed },
        Owns: (id) => id === root,
        RootId: () => root,
        RootNode: () => ({ Key: tag, Caption: tag, IconKey: tag, ExtObject: {}, Severity: NodeSeverity.Ok }),
        ObserveChildren: () => () => {},
        GetProperty: (_id, p) => p === HierarchyPropertyId.Caption ? tag : undefined,
        GetCanonicalName: () => tag,
        ParseCanonicalName: () => HierarchyItemId.Nil,
        CanAccept: () => false,
        OnRootChanged: () => ({ dispose() {} }),
        dispose: () => { disposed = true },
    }
}

describe('ProjectBranchesProvider', () =>
{
    it('emits every leading branch root in order before the file children', async () =>
    {
        const files = fakeFiles()
        const a = fakeLeading('references')
        const b = fakeLeading('active')
        const p = new ProjectBranchesProvider(files.provider, [a, b])
        const added: HierarchyItemId[] = []
        p.ObserveChildren(HierarchyItemId.Root, (c) => { if (c instanceof ChildAdded) added.push(c.Id) })
        await new Promise((r) => setTimeout(r, 5))
        expect(added[0]).toBe(a.root)            // References first
        expect(added[1]).toBe(b.root)            // active connection second
        expect(added).toContain(files.fileChild) // then files
    })

    it('dispatches GetProperty to the owning leading branch, and to files otherwise', () =>
    {
        const files = fakeFiles()
        const a = fakeLeading('references')
        const p = new ProjectBranchesProvider(files.provider, [a])
        expect(p.GetProperty(a.root, HierarchyPropertyId.Caption)).toBe('references')
        const someFileId = HierarchyItemId.Mint()
        p.GetProperty(someFileId, HierarchyPropertyId.Caption)
        expect(files.asked).toContain(someFileId)
    })

    it('dispose disposes every leading branch (no leak)', () =>
    {
        const a = fakeLeading('references')
        const b = fakeLeading('active')
        const p = new ProjectBranchesProvider(fakeFiles().provider, [a, b])
        p.dispose()
        expect(a.disposed && b.disposed).toBe(true)
    })

    it('a leading branch root update is forwarded as a ChildUpdated', async () =>
    {
        const files = fakeFiles()
        const root = HierarchyItemId.Mint()
        let fireRoot: (() => void) | undefined
        let caption = 'Active connection: …'
        const branch: LeadingBranch = {
            Owns: (id) => id === root,
            RootId: () => root,
            RootNode: () => ({ Key: 'active', Caption: caption, IconKey: 'active', ExtObject: {}, Severity: NodeSeverity.Ok }),
            ObserveChildren: () => () => {},
            GetProperty: () => undefined,
            GetCanonicalName: () => 'active',
            ParseCanonicalName: () => HierarchyItemId.Nil,
            CanAccept: () => false,
            OnRootChanged: (h) => { fireRoot = h; return { dispose() { fireRoot = undefined } } },
            dispose: () => {},
        }
        const p = new ProjectBranchesProvider(files.provider, [branch])
        const changes: HierarchyChange[] = []
        p.ObserveChildren(HierarchyItemId.Root, (c) => changes.push(c))
        await new Promise((r) => setTimeout(r, 5))
        changes.length = 0
        caption = 'Active connection: npm-public'
        fireRoot?.()
        expect(changes.map((c) => c.constructor.name)).toContain('ChildUpdated')
    })
})
