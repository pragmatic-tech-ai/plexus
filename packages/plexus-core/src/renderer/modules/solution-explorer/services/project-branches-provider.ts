import {
    HierarchyItemId, ChildAdded, ChildUpdated,
    type IHierarchyProvider, type HierarchyChange, type HierarchyNode, type HierarchyPropertyId, type DropData,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import type { Disposable } from '@pragmatic-tech-ai/todl-runtime'

// A branch that leads a project's file tree — a single row (its RootNode) plus, optionally,
// a subtree the model realizes under it. References is one such branch (an expandable root
// with groups/leaves); the per-project active-connection row is another (a single leaf whose
// caption tracks the effective connection). OnRootChanged lets a branch with a dynamic root
// (the active-connection row) re-render its own row without touching the file subtree.
export interface LeadingBranch
{
    Owns(id: HierarchyItemId): boolean
    RootId(): HierarchyItemId
    RootNode(): HierarchyNode
    ObserveChildren(node: HierarchyItemId, sink: (c: HierarchyChange) => void): () => void
    GetProperty(id: HierarchyItemId, prop: HierarchyPropertyId): unknown
    GetCanonicalName(id: HierarchyItemId): string
    ParseCanonicalName(name: string): HierarchyItemId
    CanAccept(target: HierarchyItemId, drop: DropData): boolean
    OnRootChanged(handler: () => void): Disposable
    dispose(): void
}

// Composes one project's subtree from an ordered list of leading branches plus the file
// provider, so the branches and the file tree are siblings under the (provider-owned) project
// node. On the project root it emits each leading branch's root in order (child[0], child[1],
// …), then forwards the file provider's children; every other id dispatches by ownership — the
// first leading branch that Owns(id), else the file provider (including nested folders it
// owns). The model re-enters ObserveChildren for each provider-owned child, so this dispatch
// is all the nesting needs — no framework change.
export class ProjectBranchesProvider implements IHierarchyProvider
{
    private static readonly Id = 'plexus.project-branches'
    public readonly ProviderId = ProjectBranchesProvider.Id

    private rootId: HierarchyItemId | undefined

    constructor(private readonly files: IHierarchyProvider, private readonly leading: readonly LeadingBranch[])
    {
    }

    public ObserveChildren(node: HierarchyItemId, sink: (c: HierarchyChange) => void): () => void
    {
        for (const b of this.leading)
        {
            if (b.Owns(node)) return b.ObserveChildren(node, sink)
        }
        // The first non-leading node observed is the project root; the leading branches lead
        // its children.
        if (this.rootId === undefined) this.rootId = node
        const rootSubs: Disposable[] = []
        // Guards the deferred work against a dispose that beats the microtask: the model can
        // observe-then-collapse in the same tick, and without this the microtask would still
        // subscribe OnRootChanged (orphaned) and emit ChildAdded into a stale sink.
        let disposed = false
        if (node === this.rootId)
        {
            const leading = this.leading
            // Emit asynchronously: the model assigns entry.dispose to the RESULT of this call,
            // so a synchronous sink() would run patch() while entry.dispose is still undefined
            // and be dropped. A microtask fires after the subscription is recorded (the
            // async-initial-children contract ProjectContentProvider relies on).
            queueMicrotask(() =>
            {
                if (disposed) return
                for (const b of leading) sink(new ChildAdded(b.RootId(), b.RootNode()))
                for (const b of leading) rootSubs.push(b.OnRootChanged(() => sink(new ChildUpdated(b.RootId(), b.RootNode()))))
            })
        }
        const filesOff = this.files.ObserveChildren(node, sink)
        return () => { disposed = true; filesOff(); for (const s of rootSubs) s.dispose() }
    }

    public GetProperty(id: HierarchyItemId, prop: HierarchyPropertyId): unknown
    {
        const owner = this.ownerOf(id)
        return owner !== undefined ? owner.GetProperty(id, prop) : this.files.GetProperty(id, prop)
    }

    public GetCanonicalName(id: HierarchyItemId): string
    {
        const owner = this.ownerOf(id)
        return owner !== undefined ? owner.GetCanonicalName(id) : this.files.GetCanonicalName(id)
    }

    public ParseCanonicalName(name: string): HierarchyItemId
    {
        for (const b of this.leading)
        {
            const id = b.ParseCanonicalName(name)
            if (id !== HierarchyItemId.Nil) return id
        }
        return this.files.ParseCanonicalName(name)
    }

    public CanAccept(target: HierarchyItemId, drop: DropData): boolean
    {
        const owner = this.ownerOf(target)
        return owner !== undefined ? owner.CanAccept(target, drop) : this.files.CanAccept(target, drop)
    }

    public dispose(): void
    {
        for (const b of this.leading) b.dispose()
    }

    private ownerOf(id: HierarchyItemId): LeadingBranch | undefined
    {
        for (const b of this.leading)
        {
            if (b.Owns(id)) return b
        }
        return undefined
    }
}
