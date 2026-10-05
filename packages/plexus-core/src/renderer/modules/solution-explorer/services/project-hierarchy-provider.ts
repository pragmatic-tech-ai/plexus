import {
    HierarchyItemsDrop,
    type HierarchyItem, type HierarchyItemInit, type ItemId,
    type IHierarchyProvider, type IRealizeContext, type DropData, type NodeContribution,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { Disposable, type IDisposable } from '@pragmatic-tech-ai/mural/runtime'
import {
    ContentAdded, ContentUpdated, ContentRemoved, ContentNodeKey, ProjectNodeKind,
    type ProjectContentStore, type ProjectContentNode, type ContentChange, type ContentNodeId,
} from '@pragmatic-tech-ai/todl'

// The content subtree of one project member, over the TODL-native ProjectContentStore.
// Rebuilt from todl's removed ProjectContentProvider against mural's B+C1 provider
// contract: instead of answering ObserveChildren/GetProperty for the model, Realize
// PUSHES HierarchyItems into the realizing item via the IRealizeContext and returns the
// store subscription as its teardown. One HierarchyItem is minted per store node and
// reused (interned by ContentNodeId), so a ContentUpdated mutates the SAME row in place
// (stable selection/expansion) and a rename keeps the row. Canonical names are the node's
// live project-relative Path (fresh: recomputed from the node, so a rename is reflected);
// a path no longer present parses back to undefined.
export class ProjectHierarchyProvider implements IHierarchyProvider
{
    private static readonly Id = 'plexus.project-content'
    public readonly ProviderId = ProjectHierarchyProvider.Id

    // One HierarchyItem per store node, keyed both ways plus by live path (for
    // ParseCanonicalName) and by ItemId (for CanAccept, whose DropData carries ItemIds).
    private readonly itemByContentId = new Map<ContentNodeId, HierarchyItem>()
    private readonly contentByItem = new Map<HierarchyItem, ProjectContentNode>()
    private readonly itemByPath = new Map<string, HierarchyItem>()
    private readonly pathByItem = new Map<HierarchyItem, string>()
    private readonly itemById = new Map<ItemId, HierarchyItem>()
    // The project mount row (the provider's realize entry) — only this UNBOUND item binds to
    // the store root; any other unbound row routed here realizes no children.
    private mountItem: HierarchyItem | undefined

    constructor(private readonly store: ProjectContentStore)
    {
    }

    public Realize(item: HierarchyItem, context: IRealizeContext): IDisposable
    {
        // The tree now paints an expand chevron on every row optimistically (retracted once
        // a node expands to nothing), so ANY row can be expanded — and the delegating
        // ProjectsProvider routes anything that isn't a reference-branch node here. Enumerate
        // children only for rows this provider actually owns, or folderIdOf would bind an
        // unrelated row to the store root and re-emit the whole project tree beneath it.
        const node = this.contentByItem.get(item)
        if (node !== undefined)
        {
            // A bound content node enumerates only when it is a FOLDER; a file is a leaf.
            if (node.Kind !== ProjectNodeKind.Folder) return Disposable.None
        }
        else
        {
            // The only UNBOUND row we own is the project mount row — captured on its first
            // realize and bound to the store root by folderIdOf below. Any other unbound row
            // (e.g. a reference leaf routed here) is not ours: no children.
            if (this.mountItem === undefined) this.mountItem = item
            else if (item !== this.mountItem) return Disposable.None
        }
        const folderId = this.folderIdOf(item)
        const watch = { disposed: false }
        const off = this.store.ObserveChildren(folderId, (change: ContentChange) =>
        {
            if (watch.disposed) return
            if (change instanceof ContentAdded)        this.onAdded(change.Node, context)
            else if (change instanceof ContentUpdated) this.onUpdated(change.Node)
            else if (change instanceof ContentRemoved) this.onRemoved(change.Id, context)
        })
        return new Disposable(() =>
        {
            watch.disposed = true
            off()
        })
    }

    // The content provider mints every child from its store; it accepts no
    // contributor-injected keyed nodes, so there is nothing to integrate.
    public Integrate(_item: HierarchyItem, _contributions: readonly NodeContribution[]): void
    {
    }

    // Fresh: the node's current Path (mutated in place on rename), never a cached string.
    public GetCanonicalName(item: HierarchyItem): string
    {
        return this.contentByItem.get(item)?.Path ?? ''
    }

    public ParseCanonicalName(name: string): HierarchyItem | undefined
    {
        return this.itemByPath.get(name)
    }

    // Accept only when `target` is a folder in THIS provider and no dragged id is the
    // target itself or an ancestor of it (a folder cannot move under its own subtree).
    // A foreign id (no node) rejects — cross-provider drops are out of scope.
    public CanAccept(target: HierarchyItem, drop: DropData): boolean
    {
        const ids = HierarchyItemsDrop.ItemsOf(drop)
        if (ids === undefined || ids.length === 0) return false
        const targetNode = this.contentByItem.get(target)
        if (targetNode === undefined || targetNode.Kind !== ProjectNodeKind.Folder) return false
        for (const id of ids)
        {
            const node = this.nodeByItemId(id)
            if (node === undefined) return false
            if (node.Path === targetNode.Path) return false
            if (targetNode.Path.startsWith(`${node.Path}/`)) return false
        }
        return true
    }

    private folderIdOf(item: HierarchyItem): ContentNodeId
    {
        const node = this.contentByItem.get(item)
        if (node !== undefined) return node.Id
        // The mount (project) row: bind it to the store root so CanAccept on the root and
        // ParseCanonicalName('') resolve to it, then enumerate the root folder.
        this.bind(item, this.store.Root)
        return this.store.Root.Id
    }

    private onAdded(node: ProjectContentNode, context: IRealizeContext): void
    {
        let child = this.itemByContentId.get(node.Id)
        if (child === undefined)
        {
            child = context.NewItem(ContentNodeKey.For(node.Kind), ProjectHierarchyProvider.initFor(node))
            this.bind(child, node)
        }
        context.InsertChild(child)
    }

    private onUpdated(node: ProjectContentNode): void
    {
        const child = this.itemByContentId.get(node.Id)
        if (child === undefined) return
        const oldPath = this.pathByItem.get(child)
        if (oldPath !== undefined && oldPath !== node.Path) this.itemByPath.delete(oldPath)
        this.itemByPath.set(node.Path, child)
        this.pathByItem.set(child, node.Path)
        this.contentByItem.set(child, node)
        child.Caption = node.Name
        child.IconKey = ContentNodeKey.For(node.Kind)
    }

    private onRemoved(id: ContentNodeId, context: IRealizeContext): void
    {
        const child = this.itemByContentId.get(id)
        if (child === undefined) return
        context.RemoveChild(child)
        this.forget(id, child)
    }

    private bind(item: HierarchyItem, node: ProjectContentNode): void
    {
        this.itemByContentId.set(node.Id, item)
        this.contentByItem.set(item, node)
        this.itemByPath.set(node.Path, item)
        this.pathByItem.set(item, node.Path)
        this.itemById.set(item.Id, item)
    }

    private forget(id: ContentNodeId, item: HierarchyItem): void
    {
        this.itemByContentId.delete(id)
        this.contentByItem.delete(item)
        const path = this.pathByItem.get(item)
        if (path !== undefined) this.itemByPath.delete(path)
        this.pathByItem.delete(item)
        this.itemById.delete(item.Id)
    }

    private nodeByItemId(id: ItemId): ProjectContentNode | undefined
    {
        const item = this.itemById.get(id)
        return item === undefined ? undefined : this.contentByItem.get(item)
    }

    private static initFor(node: ProjectContentNode): HierarchyItemInit
    {
        return {
            Caption: node.Name,
            IconKey: ContentNodeKey.For(node.Kind),
            IsExpandable: node.Kind === ProjectNodeKind.Folder,
            ExtObject: node,
            CanonicalSegment: node.Name,
        }
    }
}
