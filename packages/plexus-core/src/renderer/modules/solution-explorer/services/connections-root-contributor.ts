import {
    NodeContribution, ProviderContribution, NodeSeverity, NodeKey,
    type IHierarchyContributor, type HierarchyNode, type HierarchyContribution,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { ConnectionsProvider } from './connections-provider.js'
import type { IConnectionView } from './connection-view.js'

// Attaches the global Connections branch under the Solution root: a keyed `Connections`
// node (sibling of the project rows), whose subtree is owned by a single ConnectionsProvider
// (a ProviderContribution). One contributor handles both parents — the Solution root (emit
// the Connections node) and the Connections node (attach the provider) — mirroring how
// ProjectsListingContributor + FileTreeContributor split node vs. subtree, kept together
// here because there is exactly one Connections node.
export class ConnectionsRootContributor implements IHierarchyContributor
{
    private static readonly RootCaption = 'Connections'
    public readonly ParentKeys = [NodeKey.Solution, NodeKey.Connections]
    public readonly Order = -1   // Connections leads the project rows under the solution

    private readonly rootMarker = Object.freeze({ connections: true })
    private readonly provider: ConnectionsProvider

    constructor(view: IConnectionView)
    {
        this.provider = new ConnectionsProvider(view)
    }

    public Contribute(parent: HierarchyNode): HierarchyContribution
    {
        if (parent.Key === NodeKey.Connections) return new ProviderContribution(this.provider)
        return new NodeContribution([{
            Key: NodeKey.Connections,
            Caption: ConnectionsRootContributor.RootCaption,
            IconKey: NodeKey.Connections,
            ExtObject: this.rootMarker,
            Severity: NodeSeverity.Ok,
            IsExpandable: true,
        }])
    }

    public dispose(): void { this.provider.dispose() }
}
