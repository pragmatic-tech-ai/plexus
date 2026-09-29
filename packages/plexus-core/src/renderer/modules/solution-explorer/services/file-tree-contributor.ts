import {
    NodeContribution, ProviderContribution, NodeKey,
    type IHierarchyContributor, type HierarchyNode, type HierarchyContribution,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import {
    ProjectContentStore, ProjectContentProvider,
    type SolutionMember, SolutionMemberStatus,
} from '@pragmatic-tech-ai/todl'

// Mounts one ProjectContentProvider (over a lazy, disk-watched ProjectContentStore) per
// resolved member row; an unresolved member is an empty leaf. Caches the store + provider
// per member so a repeated Contribute returns the SAME provider instance (the model's
// attachProvider guards re-subscription by identity), and disposes them (releasing the
// chokidar watchers) when a member is pruned or the contributor is torn down.
export class FileTreeContributor implements IHierarchyContributor
{
    private static readonly EmptyLeaf = new NodeContribution([])
    public readonly ParentKeys = [NodeKey.Project]
    public readonly Order = 0

    private readonly stores = new Map<SolutionMember, ProjectContentStore>()
    private readonly providers = new Map<SolutionMember, ProjectContentProvider>()

    public Contribute(parent: HierarchyNode): HierarchyContribution
    {
        const member = parent.ExtObject as SolutionMember
        if (member.Status !== SolutionMemberStatus.Resolved || member.Storage === undefined)
        {
            return FileTreeContributor.EmptyLeaf
        }
        let provider = this.providers.get(member)
        if (provider === undefined)
        {
            const store = new ProjectContentStore(member.Storage)
            this.stores.set(member, store)
            provider = new ProjectContentProvider(store)
            this.providers.set(member, provider)
        }
        return new ProviderContribution(provider)
    }

    // Release one member's store + provider when that member row is pruned.
    public Release(member: SolutionMember): void
    {
        const store = this.stores.get(member)
        if (store !== undefined)
        {
            store.dispose()
            this.stores.delete(member)
        }
        this.providers.delete(member)
    }

    public dispose(): void
    {
        for (const store of this.stores.values()) store.dispose()
        this.stores.clear()
        this.providers.clear()
    }
}
