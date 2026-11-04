import type { DialogService } from '@pragmatic-tech-ai/mural/framework'
import type { IAccountService } from '../../account/account-service.js'
import type { IGraphContributor } from '../../graph-contribute/graph-contributor.js'
import {
    TargetKind, TargetStatus, type AccountTargets, type EnvironmentTarget, type TargetChoice,
} from '../../../../shared/account-api.js'
import { TargetDialog } from './target-dialog.js'

// The bindable property names the contribute picker adds.
enum ContributeTargetProperty
{
    Graphs = 'Graphs',
    HasGraphs = 'HasGraphs',
    SelectedGraph = 'SelectedGraph',
    CanContribute = 'CanContribute',
}

// "Contribute to graph": one of the account's Development environments and one of its graphs. The
// graphs are listed (through the relay) whenever a running environment is selected.
export class ContributeTargetDialog extends TargetDialog
{
    private static readonly DialogTitle = 'Contribute to graph'
    private static readonly SignIn = 'Sign in to contribute to an environment.'
    private static readonly NoEnvironments = 'Your account has no development environments to contribute to.'
    private static readonly NoGraphs = 'This environment has no graphs yet. Create one in the tenant console.'

    private readonly graphSource: IGraphContributor
    private graphs: string[] = []
    private selectedGraph: string | undefined = undefined
    // Bumped on every environment selection, so a slow ListGraphs for an earlier one is dropped.
    private graphLoad = 0

    public constructor(account: IAccountService, graphSource: IGraphContributor, dialogs: DialogService)
    {
        super(account, dialogs)
        this.graphSource = graphSource
    }

    protected get Title(): string { return ContributeTargetDialog.DialogTitle }
    protected get Kind(): TargetKind { return TargetKind.Contribute }
    protected get SignInSentence(): string { return ContributeTargetDialog.SignIn }
    protected get NoEnvironmentsSentence(): string { return ContributeTargetDialog.NoEnvironments }

    public get Graphs(): readonly string[] { return this.graphs }
    public get HasGraphs(): boolean { return this.graphs.length > 0 }

    public get SelectedGraph(): string | undefined { return this.selectedGraph }
    public set SelectedGraph(value: string | undefined)
    {
        if (value === this.selectedGraph) return
        const old = this.selectedGraph
        this.selectedGraph = value
        this.RaisePropertyChanged(ContributeTargetProperty.SelectedGraph, old, value)
        this.RefreshCanConfirm()
    }

    // Signed in, a running environment and one of its graphs chosen.
    public get CanContribute(): boolean { return this.IsReady() }

    protected override IsReady(): boolean
    {
        return super.IsReady() && this.selectedGraph !== undefined
    }

    protected override RefreshCanConfirm(): void
    {
        super.RefreshCanConfirm()
        this.RaisePropertyChanged(ContributeTargetProperty.CanContribute, undefined, this.CanContribute)
    }

    protected TargetsFor(targets: AccountTargets): readonly EnvironmentTarget[]
    {
        return targets.Contribute
    }

    protected ChoiceFor(environment: EnvironmentTarget): TargetChoice | undefined
    {
        const graph = this.selectedGraph
        return graph === undefined ? undefined : { Environment: environment.Name, GraphName: graph }
    }

    protected override OnEnvironmentSelected(environment: EnvironmentTarget | undefined, load: number): void
    {
        const graphLoad = ++this.graphLoad
        this.SetGraphs([])
        this.SelectedGraph = undefined
        if (environment === undefined || environment.Status !== TargetStatus.Running) return
        void this.LoadGraphs(environment, load, graphLoad)
    }

    private async LoadGraphs(environment: EnvironmentTarget, load: number, graphLoad: number): Promise<void>
    {
        this.SetBusy(true)
        let graphs: string[]
        try
        {
            graphs = await this.graphSource.ListGraphs(environment.Name)
        }
        catch (e)
        {
            if (this.IsCurrentGraphs(load, graphLoad))
            {
                this.SetBusy(false)
                this.ShowFailure(e)
            }
            return
        }
        if (!this.IsCurrentGraphs(load, graphLoad)) return
        this.SetBusy(false)
        this.SetGraphs(graphs)
        if (graphs.length === 0)
        {
            this.SetMessage(ContributeTargetDialog.NoGraphs)
            return
        }
        const last = this.LastChoice
        const remembered = last?.Environment === environment.Name ? last.GraphName : undefined
        this.SelectedGraph = graphs.find((g) => g === remembered) ?? graphs[0]
    }

    private IsCurrentGraphs(load: number, graphLoad: number): boolean
    {
        return this.IsCurrent(load) && graphLoad === this.graphLoad
    }

    private SetGraphs(value: string[]): void
    {
        if (value.length === 0 && this.graphs.length === 0) return
        const old = this.graphs
        this.graphs = value
        this.RaisePropertyChanged(ContributeTargetProperty.Graphs, old, value)
        this.RaisePropertyChanged(ContributeTargetProperty.HasGraphs, old.length > 0, value.length > 0)
    }
}

export default ContributeTargetDialog
