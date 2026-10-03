import { type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import {
    NodeContribution, ProviderContribution, NodeSeverity, NodeKey,
    type IHierarchyContributor, type HierarchyItem, type HierarchyContribution,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { type CommandContext } from '@pragmatic-tech-ai/mural/framework'
import { type SolutionMember } from '@pragmatic-tech-ai/todl'
import { FileTreeContributor } from './file-tree-contributor.js'
import { ReferencesProvider } from './references-provider.js'
import type { IReferenceView } from './reference-view.js'

// Attaches the per-project References branch as an INDEPENDENT peer under each consumer
// project row (sibling of the file tree, which it leads): a keyed `References` node whose
// subtree is owned by a member-scoped ReferencesProvider. One contributor handles both
// parents — the Project row (emit the References node for a references consumer) and the
// References node (attach that member's provider) — mirroring how ConnectionsRootContributor
// splits node vs. subtree. Replaces the retired ProjectBranchesProvider composite +
// ReferencesLeadingBranch: References is no longer woven into the file provider's children.
export class ReferencesContributor implements IHierarchyContributor
{
    private static readonly RootCaption = 'References'
    private static readonly RootCanonicalSegment = 'references'

    // Leads the file tree (Order 0) under a project row; also matches the References node
    // itself to mount the provider.
    public readonly ParentKeys = [NodeKey.Project, NodeKey.References]
    public readonly Order = -1

    // One synthetic root marker + one provider per consumer member, cached so a repeated
    // Contribute returns the SAME ExtObject (the interning identity) and the SAME provider
    // instance (attachProvider guards re-subscription by identity).
    private readonly rootMarkers = new Map<SolutionMember, object>()
    private readonly providers = new Map<SolutionMember, ReferencesProvider>()

    constructor(private readonly view: IReferenceView)
    {
    }

    public Contribute(parent: HierarchyItem): HierarchyContribution
    {
        if (parent.Key === NodeKey.References)
        {
            const member = FileTreeContributor.MemberOf(parent)
            if (member === undefined) return new NodeContribution([])
            return new ProviderContribution(this.providerFor(member))
        }
        // parent.Key === NodeKey.Project — surface a References node only for a references
        // consumer (architecture / library); a meta-model project gets none.
        const member = parent.ExtObject as SolutionMember
        if (!this.view.IsConsumer(member)) return new NodeContribution([])
        return new NodeContribution([{
            Key: NodeKey.References,
            Caption: ReferencesContributor.RootCaption,
            IconKey: NodeKey.References,
            ExtObject: this.markerFor(member),
            Severity: NodeSeverity.Ok,
            IsExpandable: true,
            CanonicalSegment: ReferencesContributor.RootCanonicalSegment,
        }])
    }

    // No commands of its own — the References actions are the ReferenceActionsContributor's.
    public Resolve(_commandId: string, _context: CommandContext): ICommand | undefined
    {
        return undefined
    }

    private markerFor(member: SolutionMember): object
    {
        let marker = this.rootMarkers.get(member)
        if (marker === undefined)
        {
            marker = Object.freeze({ references: member.Ref.path })
            this.rootMarkers.set(member, marker)
        }
        return marker
    }

    private providerFor(member: SolutionMember): ReferencesProvider
    {
        let provider = this.providers.get(member)
        if (provider === undefined)
        {
            provider = new ReferencesProvider(member, this.view)
            this.providers.set(member, provider)
        }
        return provider
    }

    // Drop one member's cached marker + provider when its row is pruned. The provider's live
    // subscription (per Realize) is torn down by the owning Hierarchy's composition teardown.
    public Release(member: SolutionMember): void
    {
        this.rootMarkers.delete(member)
        this.providers.delete(member)
    }

    public dispose(): void
    {
        this.rootMarkers.clear()
        this.providers.clear()
    }
}
