import { RelayCommand, ServiceKey, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import {
    NodeContribution, NodeKey,
    type IHierarchyContributor, type HierarchyContribution, type HierarchyItem,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { HierarchyContext } from '@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-context.js'
import { CommandDefinition, DialogService, type CommandContext } from '@pragmatic-tech-ai/mural/framework'
import type { Solution } from '@pragmatic-tech-ai/todl'
import { BackgroundWorkService } from '../../background-work/index.js'
import type { IGraphContributor } from '../../graph-contribute/graph-contributor.js'
import type { SolutionPackageBuilder } from '../../graph-contribute/solution-package-builder.js'
import type { GraphContributeResult } from '../../../../shared/graph-contribute-api.js'
import { InfoDialog } from './info-dialog.js'
import type { GraphTargetInput, IGraphTargetPrompt } from './graph-profile-dialog.js'

// Contributes the "Contribute to graph…" command to the Solution root row. Contribute asks for the
// target environment + graph, builds the whole active solution's packages via
// SolutionPackageBuilder, then hands them to IGraphContributor.Contribute (whose main-process side
// posts them through the tenant plane relay; no credential ever reaches the renderer). A build /
// sign-in / refusal / conflict failure throws inside the background task and fails that row with
// its sentence. Action-only (Contribute yields no nodes); closes over the solution.
export class ContributeToGraphContributor implements IHierarchyContributor
{
    public static readonly Key = new ServiceKey<ContributeToGraphContributor>('ContributeToGraphContributor')

    public static readonly ContributeCommandId = 'graph.contribute'

    private static readonly ContributeLabel = 'Contribute to graph…'
    private static readonly TitlePrefix = 'Contributing '
    private static readonly ToGraph = ' to graph '
    private static readonly ContributeFailedTitle = 'Contribute to graph failed'
    private static readonly ContributedTitle = 'Contributed to graph'
    private static readonly CountSeparator = ' - packages contributed: '

    public readonly ParentKeys = [NodeKey.Solution]
    public readonly Order = 23

    public readonly Actions: readonly CommandDefinition[]

    constructor(
        private readonly solution: Solution,
        private readonly builder: SolutionPackageBuilder | undefined,
        private readonly work: BackgroundWorkService | undefined,
        private readonly contributor: IGraphContributor | undefined,
        private readonly dialogs: DialogService | undefined,
        private readonly prompt: IGraphTargetPrompt | undefined = undefined)
    {
        this.Actions = [
            ContributeToGraphContributor.command(ContributeToGraphContributor.ContributeCommandId, ContributeToGraphContributor.ContributeLabel, 56),
        ]
    }

    private static command(id: string, title: string, order: number): CommandDefinition
    {
        const def = new CommandDefinition()
        def.Id = id
        def.Title = title
        def.Order = order
        def.Context = HierarchyContext.For(NodeKey.Solution)
        return def
    }

    public Contribute(_parent: HierarchyItem): HierarchyContribution
    {
        return new NodeContribution([])
    }

    public Resolve(commandId: string, _context: CommandContext): ICommand | undefined
    {
        if (commandId !== ContributeToGraphContributor.ContributeCommandId) return undefined
        return new RelayCommand(() => void this.contribute(), () => this.builder !== undefined && this.contributor !== undefined && this.work !== undefined && this.prompt !== undefined)
    }

    // Asks for the target environment + graph, then runs the build+contribute under a background
    // task so a build / sign-in / refusal / conflict failure fails that row with its sentence. A
    // prompt failure blocks early via InfoDialog.
    private async contribute(): Promise<void>
    {
        const builder = this.builder
        const contributor = this.contributor
        const work = this.work
        const prompt = this.prompt
        if (builder === undefined || contributor === undefined || work === undefined || prompt === undefined) return
        let target: GraphTargetInput
        try
        {
            const input = await prompt.Prompt()
            if (input === undefined) return
            target = input
        }
        catch (e)
        {
            this.surface(ContributeToGraphContributor.ContributeFailedTitle, e)
            return
        }
        const graphName = target.GraphName
        const solution = this.solution
        void work.run(`${ContributeToGraphContributor.TitlePrefix}${solution.Name}${ContributeToGraphContributor.ToGraph}${graphName}`, async (_ctx): Promise<GraphContributeResult> =>
        {
            const packages = [...await builder.Build()]
            return contributor.Contribute(target.Environment, graphName, solution.Name, packages)
        }).done.then(
            (result) =>
            {
                if (this.dialogs !== undefined)
                {
                    void InfoDialog.Show(this.dialogs, ContributeToGraphContributor.ContributedTitle, `${graphName}${ContributeToGraphContributor.CountSeparator}${result.PackageCount}`)
                }
            },
            () => { /* failure is already shown in the background task row */ },
        )
    }

    // Blocking error surface: the Solution Explorer has no toast/status channel, so failures
    // in the pre-task steps show through InfoDialog.
    private surface(title: string, error: unknown): void
    {
        const dialogs = this.dialogs
        if (dialogs === undefined) return
        void InfoDialog.Show(dialogs, title, error instanceof Error ? error.message : String(error))
    }
}

export default ContributeToGraphContributor
