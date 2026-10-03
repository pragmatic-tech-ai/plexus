import { type ICommand, type IDisposable } from '@pragmatic-tech-ai/mural/runtime'
import {
    NodeContribution, NodeSeverity, NodeKey,
    type IHierarchyContributor, type HierarchyItem, type HierarchyNodeSpec,
    type HierarchyContributorRegistry,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { type CommandContext } from '@pragmatic-tech-ai/mural/framework'
import { type Solution, type SolutionMember, SolutionMemberStatus } from '@pragmatic-tech-ai/todl'

// Contributes one project row per solution member under the solution root. Reactive:
// re-notifies the registry (-> Hierarchy re-contributes the root) when Members
// change or a member's Status flips, so rows appear/vanish and repaint their severity
// while keeping their id (ExtObject = the SolutionMember, the interning identity).
export class ProjectsListingContributor implements IHierarchyContributor
{
    private static readonly StatusProp = 'Status'
    public readonly ParentKeys = [NodeKey.Solution]
    public readonly Order = 0

    private readonly membersOff: () => void
    private readonly statusOff = new Map<SolutionMember, IDisposable>()

    constructor(
        private readonly solution: Solution,
        private readonly registry: HierarchyContributorRegistry,
    )
    {
        for (const m of this.solution.Members) this.watchStatus(m)
        this.membersOff = this.solution.Members.Subscribe(() => this.onMembersChanged())
    }

    public Contribute(_parent: HierarchyItem): NodeContribution
    {
        const nodes: HierarchyNodeSpec[] = []
        for (const m of this.solution.Members)
        {
            nodes.push({
                Key: NodeKey.Project,
                Caption: m.Title,
                IconKey: NodeKey.Project,
                ExtObject: m,
                Severity: ProjectsListingContributor.severityOf(m),
                Error: m.Error,
                IsExpandable: m.Status === SolutionMemberStatus.Resolved,
                CanonicalSegment: m.Ref.path,
            })
        }
        return new NodeContribution(nodes)
    }

    // ProjectsListingContributor contributes no commands — the project-row actions are
    // the ProjectActionsContributor's. The ICommandDispatcher seam (IHierarchyContributor
    // extends it) is satisfied with a no-op resolver.
    public Resolve(_commandId: string, _context: CommandContext): ICommand | undefined
    {
        return undefined
    }

    private static severityOf(m: SolutionMember): NodeSeverity
    {
        if (m.Status === SolutionMemberStatus.LoadFailed) return NodeSeverity.Error
        if (m.Status === SolutionMemberStatus.UnknownType) return NodeSeverity.Warning
        return NodeSeverity.Ok
    }

    private onMembersChanged(): void
    {
        // Re-sync per-member Status subscriptions to the live set, then re-contribute.
        const live = this.solution.Members.ToArray()
        for (const m of [...this.statusOff.keys()])
        {
            if (!live.includes(m))
            {
                this.statusOff.get(m)!.dispose()
                this.statusOff.delete(m)
            }
        }
        for (const m of live)
        {
            if (!this.statusOff.has(m)) this.watchStatus(m)
        }
        this.registry.NotifyContributionsChanged()
    }

    private watchStatus(m: SolutionMember): void
    {
        const off = m.PropertyChanged(ProjectsListingContributor.StatusProp).subscribe(() => this.registry.NotifyContributionsChanged())
        this.statusOff.set(m, off)
    }

    public dispose(): void
    {
        this.membersOff()
        for (const off of this.statusOff.values()) off.dispose()
        this.statusOff.clear()
    }
}
