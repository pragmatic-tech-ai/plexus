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
import type { IGraphProfilePrompt } from './graph-profile-dialog.js'

// Contributes the "Contribute to graph…" / "Configure graph server…" commands to the Solution
// root row. Contribute builds the whole active solution's packages via SolutionPackageBuilder,
// then hands them to IGraphContributor.Contribute (whose main-process side posts them to the
// configured dev graph over the protocol with a maker bearer token). A build/auth/conflict/
// non-dev failure throws inside the background task and fails that row with the reason. The
// maker token flows only to SetProfile — it is never logged, retained, or surfaced in any
// dialog or task reason. Action-only (Contribute yields no nodes); closes over the solution.
export class ContributeToGraphContributor implements IHierarchyContributor
{
    public static readonly Key = new ServiceKey<ContributeToGraphContributor>('ContributeToGraphContributor')

    public static readonly ContributeCommandId = 'graph.contribute'
    public static readonly ConfigureCommandId = 'graph.configure'

    private static readonly ContributeLabel = 'Contribute to graph…'
    private static readonly ConfigureLabel = 'Configure graph server…'
    private static readonly TitlePrefix = 'Contributing '
    private static readonly ToGraph = ' to graph '
    private static readonly ContributeFailedTitle = 'Contribute to graph failed'
    private static readonly ConfigureFailedTitle = 'Configure graph server failed'

    public readonly ParentKeys = [NodeKey.Solution]
    public readonly Order = 23

    public readonly Actions: readonly CommandDefinition[]

    constructor(
        private readonly solution: Solution,
        private readonly builder: SolutionPackageBuilder | undefined,
        private readonly work: BackgroundWorkService | undefined,
        private readonly contributor: IGraphContributor | undefined,
        private readonly dialogs: DialogService | undefined,
        private readonly prompt: IGraphProfilePrompt | undefined = undefined)
    {
        this.Actions = [
            ContributeToGraphContributor.command(ContributeToGraphContributor.ContributeCommandId, ContributeToGraphContributor.ContributeLabel, 56),
            ContributeToGraphContributor.command(ContributeToGraphContributor.ConfigureCommandId, ContributeToGraphContributor.ConfigureLabel, 57),
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
        if (commandId === ContributeToGraphContributor.ConfigureCommandId)
        {
            return new RelayCommand(() => void this.configure(), () => this.contributor !== undefined && this.prompt !== undefined)
        }
        if (commandId !== ContributeToGraphContributor.ContributeCommandId) return undefined
        return new RelayCommand(() => void this.contribute(), () => this.builder !== undefined && this.contributor !== undefined && this.work !== undefined)
    }

    // Collects URL + token and hands them to the main-side store. The token goes straight to
    // SetProfile and is neither logged nor retained here; a failure surfaces via InfoDialog.
    private async configure(): Promise<void>
    {
        const contributor = this.contributor
        const prompt = this.prompt
        if (contributor === undefined || prompt === undefined) return
        const input = await prompt.Prompt()
        if (input === undefined) return
        try
        {
            await contributor.SetProfile(input.ServerUrl, input.Token)
        }
        catch (e)
        {
            this.surface(ContributeToGraphContributor.ConfigureFailedTitle, e)
        }
    }

    // Prompts for the target graph (and, when no profile is stored yet, the server URL + token
    // it persists first), then runs the build+contribute under a background task so a build /
    // auth / conflict / non-dev failure fails that row with the reason. The prompt + SetProfile
    // run before the task so a cancel / bad-profile error blocks early via InfoDialog.
    private async contribute(): Promise<void>
    {
        const builder = this.builder
        const contributor = this.contributor
        const work = this.work
        const prompt = this.prompt
        if (builder === undefined || contributor === undefined || work === undefined || prompt === undefined) return
        let graphName: string
        try
        {
            const input = await prompt.Prompt()
            if (input === undefined) return
            if (!(await contributor.HasProfile()))
            {
                await contributor.SetProfile(input.ServerUrl, input.Token)
            }
            graphName = input.GraphName
        }
        catch (e)
        {
            this.surface(ContributeToGraphContributor.ContributeFailedTitle, e)
            return
        }
        const solution = this.solution
        void work.run(`${ContributeToGraphContributor.TitlePrefix}${solution.Name}${ContributeToGraphContributor.ToGraph}${graphName}`, async (_ctx): Promise<GraphContributeResult> =>
        {
            const packages = [...await builder.Build()]
            return contributor.Contribute(graphName, solution.Name, packages)
        })
    }

    // Blocking error surface: the Solution Explorer has no toast/status channel, so failures
    // in the pre-task steps show through InfoDialog. The token never appears in a message.
    private surface(title: string, error: unknown): void
    {
        const dialogs = this.dialogs
        if (dialogs === undefined) return
        void InfoDialog.Show(dialogs, title, error instanceof Error ? error.message : String(error))
    }
}

export default ContributeToGraphContributor
