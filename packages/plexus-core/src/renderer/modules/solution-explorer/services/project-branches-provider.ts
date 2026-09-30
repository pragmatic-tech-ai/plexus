import {
    HierarchyItemId, ChildAdded,
    type IHierarchyProvider, type HierarchyChange, type HierarchyPropertyId, type DropData,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import type { ReferencesProvider } from './references-provider.js'

// Composes one project's subtree from two sub-providers so References and the file tree
// are siblings under the (provider-owned) project node. On the project root it emits the
// References node first (child[0]), then forwards the file provider's children; every
// other id dispatches by ownership — refs.Owns(id) → the References provider, else the
// file provider (including nested file folders, which the file provider owns). The model
// re-enters ObserveChildren for each provider-owned child, so this dispatch is all the
// nesting needs — no framework change.
export class ProjectBranchesProvider implements IHierarchyProvider
{
    private static readonly Id = 'plexus.project-branches'
    public readonly ProviderId = ProjectBranchesProvider.Id

    private rootId: HierarchyItemId | undefined

    constructor(private readonly files: IHierarchyProvider, private readonly refs: ReferencesProvider)
    {
    }

    public ObserveChildren(node: HierarchyItemId, sink: (c: HierarchyChange) => void): () => void
    {
        if (this.refs.Owns(node)) return this.refs.ObserveChildren(node, sink)
        // The first non-refs node observed is the project root; References leads its children.
        if (this.rootId === undefined) this.rootId = node
        if (node === this.rootId) sink(new ChildAdded(this.refs.ReferencesRootId(), this.refs.ReferencesRootNode()))
        return this.files.ObserveChildren(node, sink)
    }

    public GetProperty(id: HierarchyItemId, prop: HierarchyPropertyId): unknown
    {
        return this.refs.Owns(id) ? this.refs.GetProperty(id, prop) : this.files.GetProperty(id, prop)
    }

    public GetCanonicalName(id: HierarchyItemId): string
    {
        return this.refs.Owns(id) ? this.refs.GetCanonicalName(id) : this.files.GetCanonicalName(id)
    }

    public ParseCanonicalName(name: string): HierarchyItemId
    {
        const fromRefs = this.refs.ParseCanonicalName(name)
        return fromRefs !== HierarchyItemId.Nil ? fromRefs : this.files.ParseCanonicalName(name)
    }

    public CanAccept(target: HierarchyItemId, drop: DropData): boolean
    {
        return this.refs.Owns(target) ? this.refs.CanAccept(target, drop) : this.files.CanAccept(target, drop)
    }

    public dispose(): void { this.refs.dispose() }
}
