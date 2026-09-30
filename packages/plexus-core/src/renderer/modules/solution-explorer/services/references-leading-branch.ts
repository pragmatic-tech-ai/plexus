import type { HierarchyItemId, HierarchyChange, HierarchyNode, HierarchyPropertyId, DropData } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import type { Disposable } from '@pragmatic-tech-ai/todl-runtime'
import type { LeadingBranch } from './project-branches-provider.js'
import type { ReferencesProvider } from './references-provider.js'

// Adapts the existing ReferencesProvider to the LeadingBranch shape. The root caption is
// static ('References'), but its rolled-up severity is dynamic (an unresolved reference turns
// the row into a Warning), so OnRootChanged delegates to the provider's own signal.
export class ReferencesLeadingBranch implements LeadingBranch
{
    constructor(private readonly refs: ReferencesProvider)
    {
    }

    public Owns(id: HierarchyItemId): boolean { return this.refs.Owns(id) }
    public RootId(): HierarchyItemId { return this.refs.ReferencesRootId() }
    public RootNode(): HierarchyNode { return this.refs.ReferencesRootNode() }
    public ObserveChildren(node: HierarchyItemId, sink: (c: HierarchyChange) => void): () => void { return this.refs.ObserveChildren(node, sink) }
    public GetProperty(id: HierarchyItemId, prop: HierarchyPropertyId): unknown { return this.refs.GetProperty(id, prop) }
    public GetCanonicalName(id: HierarchyItemId): string { return this.refs.GetCanonicalName(id) }
    public ParseCanonicalName(name: string): HierarchyItemId { return this.refs.ParseCanonicalName(name) }
    public CanAccept(target: HierarchyItemId, drop: DropData): boolean { return this.refs.CanAccept(target, drop) }
    public OnRootChanged(handler: () => void): Disposable { return this.refs.OnRootChanged(handler) }
    public dispose(): void { this.refs.dispose() }
}
