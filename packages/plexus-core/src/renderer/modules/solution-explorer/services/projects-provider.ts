import { type ICommand, Disposable, type IDisposable } from '@pragmatic-tech-ai/mural/runtime'
import {
    NodeSeverity, NodeKey, ProviderContribution,
    type IHierarchyProvider, type IHierarchyContributor, type IRealizeContext,
    type HierarchyItem, type HierarchyItemInit, type HierarchyNodeSpec,
    type HierarchyContribution, type DropData, type NodeContribution,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { type CommandContext } from '@pragmatic-tech-ai/mural/framework'
import { type Solution, type SolutionMember, SolutionMemberStatus } from '@pragmatic-tech-ai/todl'
import { FileTreeContributor } from './file-tree-contributor.js'
import { ReferenceNodeKey } from './reference-node-key.js'

// The per-member content subtree source (the file tree). Implemented by FileTreeContributor,
// which caches one ProjectHierarchyProvider (over a disk-watched ProjectContentStore) per
// resolved member. ProjectsProvider delegates each project row's file-content realization to
// the returned provider and prunes the member's store via Release when the row is removed.
export interface IProjectContentSource
{
    ContentProviderFor(member: SolutionMember): IHierarchyProvider | undefined
    Release(member: SolutionMember): void
}

// The per-member References subtree source. Implemented by ReferencesContributor. ProjectsProvider
// mints the References node from ReferenceRootNode (undefined for a non-consumer member) and
// delegates the References subtree (groups + leaves) realization to ReferenceProviderFor.
export interface IProjectReferencesSource
{
    ReferenceRootNode(member: SolutionMember): HierarchyNodeSpec | undefined
    ReferenceProviderFor(member: SolutionMember): IHierarchyProvider | undefined
    Release(member: SolutionMember): void
}

// Owns the project rows directly under the Solution root and keeps them in step with the open
// solution by PUSHING deltas through the IRealizeContext: Realize(root) seeds one row per
// solution member and subscribes to Members + each member's Status; a member added/removed
// inserts/removes its row, and a Status flip MUTATES the existing row's props in place (so the
// row keeps its identity, selection and expansion). A row is interned by its SolutionMember.
//
// Unlike the retired keyed ProjectsListingContributor, a provider is the only mural 0.61.1
// mechanism that delta-refreshes a node's children: a keyed contributor left present across a
// NotifyContributionsChanged is skipped by hierarchy.reRealize, so its row set never updates.
//
// A project row is NOT a leaf — it carries a file tree and (for a consumer) a References branch,
// which keyed sub-contributors used to realize. But a provider-OWNED item is realized through
// mural's owned path, which drops keyed ProviderContributions (and no-ops NodeContributions via
// Integrate), so those sub-trees would vanish. ProjectsProvider therefore DELEGATES a project
// row's subtree realization to the per-member content/References providers (IProjectContentSource
// / IProjectReferencesSource): Realize routes by item — the Solution root to the row list, a
// project row to its References node + file content, a References/group node to the member's
// ReferencesProvider, and a content node to the member's ProjectHierarchyProvider.
export class ProjectsProvider implements IHierarchyProvider
{
    private static readonly Id = 'plexus.projects'
    public readonly ProviderId = ProjectsProvider.Id
    private static readonly StatusProp = 'Status'

    private readonly rowByMember = new Map<SolutionMember, HierarchyItem>()
    private readonly present = new Set<SolutionMember>()
    private readonly statusSubs = new Map<SolutionMember, IDisposable>()
    private rootItem: HierarchyItem | undefined
    private rootContext: IRealizeContext | undefined

    constructor(
        private readonly solution: Solution,
        private readonly content: IProjectContentSource,
        private readonly references: IProjectReferencesSource,
    )
    {
    }

    public Realize(item: HierarchyItem, context: IRealizeContext): IDisposable
    {
        if (item.Key === NodeKey.Solution) return this.realizeRoot(item, context)
        const member = FileTreeContributor.MemberOf(item)
        if (member === undefined) return Disposable.None
        if (item.ExtObject === member) return this.realizeProjectRow(item, member, context)
        if (item.Key === NodeKey.References || item.Key === ReferenceNodeKey.Group)
        {
            return this.references.ReferenceProviderFor(member)?.Realize(item, context) ?? Disposable.None
        }
        return this.content.ContentProviderFor(member)?.Realize(item, context) ?? Disposable.None
    }

    // The row list mints its own rows; nothing is contributor-injected.
    public Integrate(_item: HierarchyItem, _contributions: readonly NodeContribution[]): void
    {
    }

    // Canonical names are driven by HierarchyItem.CanonicalSegment, so these interface methods
    // are never invoked by mural's engine; they satisfy IHierarchyProvider for completeness.
    public GetCanonicalName(item: HierarchyItem): string
    {
        const member = FileTreeContributor.MemberOf(item)
        return member !== undefined && item.ExtObject === member ? member.Ref.path : (item.CanonicalSegment ?? '')
    }

    public ParseCanonicalName(_name: string): HierarchyItem | undefined
    {
        return undefined
    }

    // Content drops route host -> FileTreeContributor -> the member's content provider, so the
    // composite root never answers a drop itself.
    public CanAccept(_target: HierarchyItem, _drop: DropData): boolean { return false }

    private realizeRoot(item: HierarchyItem, context: IRealizeContext): IDisposable
    {
        this.rootItem = item
        this.rootContext = context
        for (const member of this.solution.Members) this.insertRow(member, context)
        const membersOff = this.solution.Members.Subscribe(() => this.onMembersChanged())
        return new Disposable(() =>
        {
            membersOff()
            for (const off of this.statusSubs.values()) off.dispose()
            this.statusSubs.clear()
            this.present.clear()
            this.rowByMember.clear()
            this.rootItem = undefined
            this.rootContext = undefined
        })
    }

    private realizeProjectRow(row: HierarchyItem, member: SolutionMember, context: IRealizeContext): IDisposable
    {
        if (member.Status !== SolutionMemberStatus.Resolved || member.Storage === undefined) return Disposable.None
        const rootNode = this.references.ReferenceRootNode(member)
        if (rootNode !== undefined) context.InsertChild(context.NewItem(rootNode.Key, rootNode))
        return this.content.ContentProviderFor(member)?.Realize(row, context) ?? Disposable.None
    }

    private onMembersChanged(): void
    {
        const context = this.rootContext
        if (context === undefined) return
        const live = this.solution.Members.ToArray()
        const liveSet = new Set(live)
        for (const member of [...this.present])
        {
            if (!liveSet.has(member)) this.removeRow(member, context)
        }
        for (const member of live)
        {
            if (!this.present.has(member)) this.insertRow(member, context)
        }
    }

    private insertRow(member: SolutionMember, context: IRealizeContext): void
    {
        let row = this.rowByMember.get(member)
        if (row === undefined)
        {
            row = context.NewItem(NodeKey.Project, ProjectsProvider.rowInit(member))
            this.rowByMember.set(member, row)
        }
        else
        {
            ProjectsProvider.applyRow(row, member)
        }
        this.present.add(member)
        context.InsertChild(row)
        if (!this.statusSubs.has(member))
        {
            this.statusSubs.set(member, member.PropertyChanged(ProjectsProvider.StatusProp).subscribe(() => this.updateRow(member)))
        }
    }

    // Remove a row when its member leaves the solution, and PROMPTLY release the member's content
    // store (its disk watcher) + References provider so a pruned project does not leak resources.
    private removeRow(member: SolutionMember, context: IRealizeContext): void
    {
        const row = this.rowByMember.get(member)
        if (row !== undefined) context.RemoveChild(row)
        this.present.delete(member)
        this.rowByMember.delete(member)
        this.statusSubs.get(member)?.dispose()
        this.statusSubs.delete(member)
        this.content.Release(member)
        this.references.Release(member)
    }

    // A Status flip repaints the SAME row in place (identity/expansion preserved).
    private updateRow(member: SolutionMember): void
    {
        const row = this.rowByMember.get(member)
        if (row === undefined) return
        ProjectsProvider.applyRow(row, member)
    }

    private static rowInit(member: SolutionMember): HierarchyItemInit
    {
        return {
            Caption: member.Title,
            IconKey: NodeKey.Project,
            Severity: ProjectsProvider.severityOf(member),
            Error: member.Error,
            IsExpandable: member.Status === SolutionMemberStatus.Resolved,
            ExtObject: member,
            CanonicalSegment: member.Ref.path,
        }
    }

    private static applyRow(row: HierarchyItem, member: SolutionMember): void
    {
        row.Caption = member.Title
        row.IconKey = NodeKey.Project
        row.Severity = ProjectsProvider.severityOf(member)
        row.Error = member.Error
        row.IsExpandable = member.Status === SolutionMemberStatus.Resolved
    }

    private static severityOf(member: SolutionMember): NodeSeverity
    {
        if (member.Status === SolutionMemberStatus.LoadFailed) return NodeSeverity.Error
        if (member.Status === SolutionMemberStatus.UnknownType) return NodeSeverity.Warning
        return NodeSeverity.Ok
    }
}

// Attaches ProjectsProvider directly under the Solution root (a ProviderContribution on the
// Solution node), peer to the keyed Connections branch. The provider owns the project rows and
// their subtrees; this contributor only hands it to the root. Contributes no commands — the
// project-row actions are ProjectActionsContributor's.
export class ProjectsRootContributor implements IHierarchyContributor
{
    public readonly ParentKeys = [NodeKey.Solution]
    public readonly Order = 0

    private readonly provider: ProjectsProvider

    constructor(solution: Solution, content: IProjectContentSource, references: IProjectReferencesSource)
    {
        this.provider = new ProjectsProvider(solution, content, references)
    }

    public Contribute(_parent: HierarchyItem): HierarchyContribution
    {
        return new ProviderContribution(this.provider)
    }

    public Resolve(_commandId: string, _context: CommandContext): ICommand | undefined
    {
        return undefined
    }

    public dispose(): void
    {
    }
}
