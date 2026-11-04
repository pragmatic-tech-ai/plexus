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
import { TargetPickerFlow, type ITargetPicker } from './target-dialog.js'

// Contributes the "Contribute to graph…" command to the Solution root row. Contribute asks the
// environment picker (ContributeTargetDialog) for the target environment + graph, builds the whole active solution's packages via
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
    private static readonly InEnvironment = ' in '
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
        private readonly picker: ITargetPicker | undefined = undefined)
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
        return new RelayCommand(() => void this.contribute(), () => this.builder !== undefined && this.contributor !== undefined && this.work !== undefined && this.picker !== undefined)
    }

    // Asks the picker for the target environment + graph (signing in first when the maker asks to,
    // see TargetPickerFlow), then runs the build+contribute under a
    // background task so a build / sign-in / refusal / conflict failure fails that row with its
    // sentence. A picker failure blocks early via InfoDialog.
    private async contribute(): Promise<void>
    {
        const builder = this.builder
        const contributor = this.contributor
        const work = this.work
        const picker = this.picker
        if (builder === undefined || contributor === undefined || work === undefined || picker === undefined) return
        let environment: string
        let graphName: string
        try
        {
            const choice = await TargetPickerFlow.Choose(picker)
            if (choice === undefined || choice.GraphName === undefined) return
            environment = choice.Environment
            graphName = choice.GraphName
        }
        catch (e)
        {
            this.surface(ContributeToGraphContributor.ContributeFailedTitle, e)
            return
        }
        const solution = this.solution
        const where = `${graphName}${ContributeToGraphContributor.InEnvironment}${environment}`
        void work.run(`${ContributeToGraphContributor.TitlePrefix}${solution.Name}${ContributeToGraphContributor.ToGraph}${where}`, async (_ctx): Promise<GraphContributeResult> =>
        {
            const packages = [...await builder.Build()]
            return contributor.Contribute(environment, graphName, solution.Name, packages)
        }).done.then(
            (result) =>
            {
                if (this.dialogs !== undefined)
                {
                    void InfoDialog.Show(this.dialogs, ContributeToGraphContributor.ContributedTitle, `${where}${ContributeToGraphContributor.CountSeparator}${result.PackageCount}`)
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
