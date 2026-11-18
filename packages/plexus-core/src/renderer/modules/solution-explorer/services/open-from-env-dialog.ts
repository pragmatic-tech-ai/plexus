import type { DialogService } from '@pragmatic-tech-ai/mural/framework'
import type { IAccountService } from '../../account/account-service.js'
import type { IEnvSolutionLister } from '../../env-solutions/env-solution-lister.js'
import {
    TargetKind, type AccountTargets, type EnvironmentTarget, type TargetChoice,
} from '../../../../shared/account-api.js'
import { TargetDialog, type EnvironmentChoice } from './target-dialog.js'

// The bindable property names the open picker adds.
enum OpenFromEnvProperty
{
    Solutions = 'Solutions',
    HasSolutions = 'HasSolutions',
    SelectedSolution = 'SelectedSolution',
}

// "Open from dev environment": one of the account's Development environments and one of its
// solutions. The solutions are listed (through a develop relay) whenever a running environment is
// selected. Resolves a TargetChoice carrying the environment and SolutionName.
export class OpenFromEnvDialog extends TargetDialog
{
    private static readonly DialogTitle = 'Open from dev environment'
    private static readonly SignIn = 'Sign in to open a solution from an environment.'
    private static readonly NoEnvironments = 'Your account has no development environments to open from.'
    private static readonly NoSolutions = 'This environment has no solutions yet. Upload one first.'

    private readonly solutionSource: IEnvSolutionLister
    private solutions: string[] = []
    private selectedSolution: string | undefined = undefined
    // Bumped on every environment selection, so a slow ListSolutions for an earlier one is dropped.
    private solutionLoad = 0

    public constructor(account: IAccountService, solutionSource: IEnvSolutionLister, dialogs: DialogService)
    {
        super(account, dialogs)
        this.solutionSource = solutionSource
    }

    protected get Title(): string { return OpenFromEnvDialog.DialogTitle }
    protected get Kind(): TargetKind { return TargetKind.Develop }
    protected get SignInSentence(): string { return OpenFromEnvDialog.SignIn }
    protected get NoEnvironmentsSentence(): string { return OpenFromEnvDialog.NoEnvironments }

    public get Solutions(): readonly string[] { return this.solutions }
    public get HasSolutions(): boolean { return this.solutions.length > 0 }

    public get SelectedSolution(): string | undefined { return this.selectedSolution }
    public set SelectedSolution(value: string | undefined)
    {
        if (value === this.selectedSolution) return
        const old = this.selectedSolution
        this.selectedSolution = value
        this.RaisePropertyChanged(OpenFromEnvProperty.SelectedSolution, old, value)
        this.RefreshCanConfirm()
    }

    // Signed in, a running environment and one of its solutions chosen (ConfirmCommand's CanExecute).
    protected override IsReady(): boolean
    {
        return super.IsReady() && this.selectedSolution !== undefined
    }

    // The develop list when the console supplies one; else the Development environments it lists for contributing.
    protected TargetsFor(targets: AccountTargets): readonly EnvironmentTarget[]
    {
        return targets.Develop ?? targets.Contribute
    }

    protected ChoiceFor(environment: EnvironmentChoice): TargetChoice | undefined
    {
        const solution = this.selectedSolution
        return solution === undefined ? undefined : { Environment: environment.Name, Source: environment.Ref.Source, SolutionName: solution }
    }

    protected override OnEnvironmentSelected(environment: EnvironmentChoice | undefined, load: number): void
    {
        const solutionLoad = ++this.solutionLoad
        // A solution list still in flight was just superseded: its busy flag is this selection's to set.
        this.SetBusy(false)
        this.SetSolutions([])
        this.SelectedSolution = undefined
        if (environment === undefined || !environment.IsRunning) return
        void this.LoadSolutions(environment, load, solutionLoad)
    }

    private async LoadSolutions(environment: EnvironmentChoice, load: number, solutionLoad: number): Promise<void>
    {
        this.SetBusy(true)
        let solutions: string[]
        try
        {
            solutions = await this.solutionSource.ListSolutions(environment.Ref)
        }
        catch (e)
        {
            if (this.IsCurrentSolutions(load, solutionLoad))
            {
                this.SetBusy(false)
                this.ShowFailure(e)
            }
            return
        }
        if (!this.IsCurrentSolutions(load, solutionLoad)) return
        this.SetBusy(false)
        this.SetSolutions(solutions)
        if (solutions.length === 0)
        {
            this.SetMessage(OpenFromEnvDialog.NoSolutions)
            return
        }
        const last = this.LastChoice
        const remembered = environment.IsRememberedAs(last) ? last?.SolutionName : undefined
        this.SelectedSolution = solutions.find((s) => s === remembered) ?? solutions[0]
    }

    private IsCurrentSolutions(load: number, solutionLoad: number): boolean
    {
        return this.IsCurrent(load) && solutionLoad === this.solutionLoad
    }

    private SetSolutions(value: string[]): void
    {
        if (value.length === 0 && this.solutions.length === 0) return
        const old = this.solutions
        this.solutions = value
        this.RaisePropertyChanged(OpenFromEnvProperty.Solutions, old, value)
        this.RaisePropertyChanged(OpenFromEnvProperty.HasSolutions, old.length > 0, value.length > 0)
    }
}

export default OpenFromEnvDialog
