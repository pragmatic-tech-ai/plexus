import { type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import {
    NodeContribution, NodeSeverity, NodeKey,
    type IHierarchyContributor, type HierarchyItem, type HierarchyContribution,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { type CommandContext } from '@pragmatic-tech-ai/mural/framework'
import { type Solution } from '@pragmatic-tech-ai/todl'

// Emits the SINGLE visible "Solution" root node under the hierarchy's invisible
// container root (SeedRoot uses ContainerKey, not NodeKey.Solution). Every
// per-solution branch — the project rows (ProjectsRootContributor) and the
// Connections node (ConnectionsRootContributor) — declares ParentKeys that
// include NodeKey.Solution, so they now hang off THIS node instead of the
// invisible container: the tree shows exactly one top-level row, the solution,
// mirroring Visual Studio's Solution Explorer. Re-created per rebuild so the
// caption/ExtObject track the active solution.
export class SolutionRootContributor implements IHierarchyContributor
{
    // The invisible container root's key — distinct from NodeKey.Solution so the
    // Solution-keyed contributors do NOT fire against the container (they fire
    // against the single node this contributor emits).
    public static readonly ContainerKey = 'solution-root-container'
    private static readonly FallbackCaption = 'Solution'

    public readonly ParentKeys = [SolutionRootContributor.ContainerKey]
    public readonly Order = 0

    constructor(private readonly solution: Solution)
    {
    }

    public Contribute(_parent: HierarchyItem): HierarchyContribution
    {
        return new NodeContribution([{
            Key: NodeKey.Solution,
            Caption: this.solution.Name || SolutionRootContributor.FallbackCaption,
            IconKey: NodeKey.Solution,
            ExtObject: this.solution,
            Severity: NodeSeverity.Ok,
            IsExpandable: true,
        }])
    }

    // No commands of its own — solution-level actions live on their own contributors.
    public Resolve(_commandId: string, _context: CommandContext): ICommand | undefined
    {
        return undefined
    }

    public dispose(): void
    {
    }
}
