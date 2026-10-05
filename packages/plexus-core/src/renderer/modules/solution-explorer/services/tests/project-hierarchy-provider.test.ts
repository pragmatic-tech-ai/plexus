import { describe, it, expect } from 'vitest'
import {
    HierarchyItemsDrop,
    type HierarchyItem, type HierarchyItemInit, type IRealizeContext, type ItemId,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import {
    ContentAdded, ContentUpdated, ContentRemoved, ContentNodeKey, ProjectContentNode, ProjectNodeKind,
    type ProjectContentStore, type ContentChange, type ContentNodeId,
} from '@pragmatic-tech-ai/todl'
import { ProjectHierarchyProvider } from '../project-hierarchy-provider.js'

// A store node's id, cast for the test (the brand is a compile-time tag only).
function contentId(raw: string): ContentNodeId
{
    return raw as unknown as ContentNodeId
}

// A fake ProjectContentStore: one observable folder (Root) whose sink the test drives
// by hand with ContentChange deltas, mirroring the real store's ObserveChildren contract
// (sync disposer returned, deltas pushed afterwards).
class FakeContentStore
{
    public readonly Root = new ProjectContentNode(contentId('root'), '', '', ProjectNodeKind.Folder)
    public disposed = false
    public observeCalls = 0
    private sink: ((change: ContentChange) => void) | undefined

    public ObserveChildren(_folder: ContentNodeId, sink: (change: ContentChange) => void): () => void
    {
        this.observeCalls++
        this.sink = sink
        return () =>
        {
            this.disposed = true
            this.sink = undefined
        }
    }

    public Emit(change: ContentChange): void
    {
        this.sink?.(change)
    }
}

// The minimal item shape the provider touches: identity + the two mutable presentation
// fields ContentUpdated writes, plus the ExtObject the init carries.
interface FakeItem
{
    Id: ItemId
    Key: string
    ExtObject: unknown
    Caption: string
    IconKey: string
}

// A fake IRealizeContext that mints FakeItems and records the realized child set.
class FakeContext implements IRealizeContext
{
    public readonly Children: FakeItem[] = []
    private next = 1

    public NewItem(key: string, init?: HierarchyItemInit): HierarchyItem
    {
        const item: FakeItem = { Id: this.next++ as ItemId, Key: key, ExtObject: init?.ExtObject, Caption: init?.Caption ?? '', IconKey: init?.IconKey ?? '' }
        return item as unknown as HierarchyItem
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

describe('ProjectHierarchyProvider.Realize', () =>
{
    function mount(): HierarchyItem
    {
        return { Id: 0 as ItemId, Key: 'project', ExtObject: {}, Caption: '', IconKey: '' } as unknown as HierarchyItem
    }

    it('inserts a child for ContentAdded with the node caption + icon', () =>
    {
        const store = new FakeContentStore()
        const provider = new ProjectHierarchyProvider(store as unknown as ProjectContentStore)
        const ctx = new FakeContext()
        provider.Realize(mount(), ctx)

        store.Emit(new ContentAdded(new ProjectContentNode(contentId('1'), 'a.todl', 'a.todl', ProjectNodeKind.Todl)))

        expect(ctx.Children.length).toBe(1)
        expect(ctx.Children[0]!.Caption).toBe('a.todl')
        expect(ctx.Children[0]!.IconKey).toBe(ContentNodeKey.For(ProjectNodeKind.Todl))
    })

    it('mutates the SAME child in place for ContentUpdated (rename), not a new insert', () =>
    {
        const store = new FakeContentStore()
        const provider = new ProjectHierarchyProvider(store as unknown as ProjectContentStore)
        const ctx = new FakeContext()
        provider.Realize(mount(), ctx)

        const node = new ProjectContentNode(contentId('1'), 'a.todl', 'a.todl', ProjectNodeKind.Todl)
        store.Emit(new ContentAdded(node))
        const child = ctx.Children[0]!

        node.Name = 'b.todl'
        node.Path = 'b.todl'
        store.Emit(new ContentUpdated(node))

        expect(ctx.Children.length).toBe(1)
        expect(ctx.Children[0]).toBe(child)
        expect(child.Caption).toBe('b.todl')
        // Canonical name is fresh (the live path) and reparses to the same item.
        expect(provider.GetCanonicalName(child as unknown as HierarchyItem)).toBe('b.todl')
        expect(provider.ParseCanonicalName('b.todl')).toBe(child as unknown as HierarchyItem)
        expect(provider.ParseCanonicalName('a.todl')).toBeUndefined()
    })

    it('removes the child for ContentRemoved and forgets its canonical name', () =>
    {
        const store = new FakeContentStore()
        const provider = new ProjectHierarchyProvider(store as unknown as ProjectContentStore)
        const ctx = new FakeContext()
        provider.Realize(mount(), ctx)

        const node = new ProjectContentNode(contentId('1'), 'a.todl', 'a.todl', ProjectNodeKind.Todl)
        store.Emit(new ContentAdded(node))
        store.Emit(new ContentRemoved(node.Id))

        expect(ctx.Children.length).toBe(0)
        expect(provider.ParseCanonicalName('a.todl')).toBeUndefined()
    })

    it('CanAccept allows a file onto a folder and rejects a non-folder target', () =>
    {
        const store = new FakeContentStore()
        const provider = new ProjectHierarchyProvider(store as unknown as ProjectContentStore)
        const ctx = new FakeContext()
        provider.Realize(mount(), ctx)

        store.Emit(new ContentAdded(new ProjectContentNode(contentId('f'), 'dir', 'dir', ProjectNodeKind.Folder)))
        store.Emit(new ContentAdded(new ProjectContentNode(contentId('1'), 'a.todl', 'a.todl', ProjectNodeKind.Todl)))
        const folder = ctx.Children[0]! as unknown as HierarchyItem
        const file = ctx.Children[1]!

        const drop = HierarchyItemsDrop.For([file.Id])
        expect(provider.CanAccept(folder, drop)).toBe(true)
        expect(provider.CanAccept(file as unknown as HierarchyItem, drop)).toBe(false)
    })

    it('realizing a FILE node enumerates nothing — no store subscription, no children (regression)', () =>
    {
        // The tree paints an expand chevron on every row (retracted once a node expands to
        // nothing), so a file row can be expanded. Realizing a file must NOT enumerate: its
        // own (non-folder) id handed to ObserveChildren would re-emit the project tree under
        // the file.
        const store = new FakeContentStore()
        const provider = new ProjectHierarchyProvider(store as unknown as ProjectContentStore)
        const ctx = new FakeContext()
        provider.Realize(mount(), ctx)
        expect(store.observeCalls).toBe(1)   // the mount enumerated the root

        store.Emit(new ContentAdded(new ProjectContentNode(contentId('1'), 'a.todl', 'a.todl', ProjectNodeKind.Todl)))
        const file = ctx.Children[0]! as unknown as HierarchyItem

        const fileCtx = new FakeContext()
        const handle = provider.Realize(file, fileCtx)

        expect(store.observeCalls).toBe(1)        // no new subscription for the file
        expect(fileCtx.Children.length).toBe(0)   // and nothing injected under it
        handle.dispose()                          // a no-op disposer, safe to call
    })

    it('an unbound non-mount row (e.g. a reference leaf routed here) realizes nothing (regression)', () =>
    {
        // Only the project mount row (the provider's realize entry) may bind to the store root.
        // A stray unbound row — a reference leaf the delegating provider routed here, now
        // expandable — must NOT be treated as the mount, or the whole project tree re-emits
        // beneath it.
        const store = new FakeContentStore()
        const provider = new ProjectHierarchyProvider(store as unknown as ProjectContentStore)
        provider.Realize(mount(), new FakeContext())
        expect(store.observeCalls).toBe(1)   // the mount enumerated the root

        const stray = { Id: 99 as ItemId, Key: 'reference-leaf', ExtObject: {}, Caption: 'x', IconKey: '' } as unknown as HierarchyItem
        const strayCtx = new FakeContext()
        const handle = provider.Realize(stray, strayCtx)

        expect(store.observeCalls).toBe(1)        // not treated as the root mount
        expect(strayCtx.Children.length).toBe(0)
        handle.dispose()
    })

    it('realizing a FOLDER node still enumerates its children', () =>
    {
        const store = new FakeContentStore()
        const provider = new ProjectHierarchyProvider(store as unknown as ProjectContentStore)
        const ctx = new FakeContext()
        provider.Realize(mount(), ctx)

        store.Emit(new ContentAdded(new ProjectContentNode(contentId('f'), 'dir', 'dir', ProjectNodeKind.Folder)))
        const folder = ctx.Children[0]! as unknown as HierarchyItem

        const folderCtx = new FakeContext()
        provider.Realize(folder, folderCtx)
        expect(store.observeCalls).toBe(2)   // the folder enumerated too
    })

    it('disposes the store subscription on teardown', () =>
    {
        const store = new FakeContentStore()
        const provider = new ProjectHierarchyProvider(store as unknown as ProjectContentStore)
        const handle = provider.Realize(mount(), new FakeContext())

        expect(store.disposed).toBe(false)
        handle.dispose()
        expect(store.disposed).toBe(true)
    })
})
