import { Observable, RelayCommand, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import type { DialogService } from '@pragmatic-tech-ai/mural/framework'
import type { IDisposable } from '@pragmatic-tech-ai/todl-runtime'
import type { IAccountService } from '../../account/account-service.js'
import {
    AccountError, AccountErrorKind, RelayError, TargetStatus,
    type AccountTargets, type EnvironmentTarget, type TargetChoice, type TargetKind,
} from '../../../../shared/account-api.js'

// Asks the maker where a contribute or publish goes. Resolves the choice, or undefined on cancel.
export interface ITargetPicker
{
    Show(): Promise<TargetChoice | undefined>;
}

// The bindable property names a target picker raises PropertyChanged for.
export enum TargetDialogProperty
{
    Environments = 'Environments',
    HasEnvironments = 'HasEnvironments',
    SelectedEnvironment = 'SelectedEnvironment',
    Message = 'Message',
    HasMessage = 'HasMessage',
    NeedsSignIn = 'NeedsSignIn',
    IsSignedIn = 'IsSignedIn',
    IsBusy = 'IsBusy',
}

// The environment picker both actions share: the signed-in account's environments for one action
// (TargetKind), the last choice pre-selected, and one plain sentence for whatever stops the action.
// Signed out, it offers a Sign in button that asks the account module to open its dialog
// (IAccountService.RequestSignIn); while open it reloads whenever the account changes. Only an
// AccountError or RelayError sentence (or one fixed sentence) is ever shown as Message.
export abstract class TargetDialog extends Observable implements ITargetPicker
{
    private static readonly Unexpected = 'Something went wrong. Try again.'
    private static readonly Stopped = 'This environment is stopped. Start it from the tenant console.'
    private static readonly NotRunning = 'This environment is not running. Check it in the tenant console.'
    private static readonly RememberFailedLog = 'TargetDialog: remembering the chosen environment failed:'

    protected readonly account: IAccountService
    private readonly dialogs: DialogService
    private readonly signInCommand: RelayCommand
    private readonly cancelCommand: RelayCommand
    private readonly confirmCommand: RelayCommand

    private environments: EnvironmentTarget[] = []
    private selectedEnvironment: EnvironmentTarget | undefined = undefined
    private message = ''
    private needsSignIn = false
    private isBusy = false
    private lastChoice: TargetChoice | undefined = undefined
    // Bumped by every load and on close, so an answer arriving after a newer load (or after the
    // picker closed) is dropped.
    private generation = 0

    protected constructor(account: IAccountService, dialogs: DialogService)
    {
        super()
        this.account = account
        this.dialogs = dialogs
        this.signInCommand = new RelayCommand(() => this.account.RequestSignIn())
        this.cancelCommand = new RelayCommand(() => this.dialogs.Close(undefined))
        this.confirmCommand = new RelayCommand(() => this.Confirm(), () => this.IsReady())
    }

    // The dialog title.
    protected abstract get Title(): string
    // Which action this picker chooses for (its targets list and its remembered choice).
    protected abstract get Kind(): TargetKind
    // What the maker is told when signed out, and when the account has no environment for the action.
    protected abstract get SignInSentence(): string
    protected abstract get NoEnvironmentsSentence(): string

    public get Environments(): readonly EnvironmentTarget[] { return this.environments }
    public get HasEnvironments(): boolean { return this.environments.length > 0 }

    public get SelectedEnvironment(): EnvironmentTarget | undefined { return this.selectedEnvironment }
    public set SelectedEnvironment(value: EnvironmentTarget | undefined)
    {
        if (value === this.selectedEnvironment) return
        const old = this.selectedEnvironment
        this.selectedEnvironment = value
        this.RaisePropertyChanged(TargetDialogProperty.SelectedEnvironment, old, value)
        this.SetMessage(TargetDialog.StatusSentence(value))
        this.OnEnvironmentSelected(value, this.generation)
        this.RefreshCanConfirm()
    }

    public get Message(): string { return this.message }
    public get HasMessage(): boolean { return this.message !== '' }
    public get NeedsSignIn(): boolean { return this.needsSignIn }
    public get IsSignedIn(): boolean { return !this.needsSignIn }
    public get IsBusy(): boolean { return this.isBusy }

    public get SignInCommand(): ICommand { return this.signInCommand }
    public get CancelCommand(): ICommand { return this.cancelCommand }
    public get ConfirmCommand(): ICommand { return this.confirmCommand }

    // Opens the picker on DialogService and loads the targets; resolves the confirmed choice.
    public async Show(): Promise<TargetChoice | undefined>
    {
        const changed: IDisposable = this.account.Changed.subscribe(() => { void this.Load() })
        const shown = this.dialogs.Show<TargetChoice>({ Title: this.Title, Content: this })
        void this.Load()
        try
        {
            return await shown
        }
        finally
        {
            changed.dispose()
            this.generation++
        }
    }

    // A signed-in, running environment is chosen (and whatever else the action needs).
    protected IsReady(): boolean
    {
        return !this.needsSignIn && !this.isBusy && this.selectedEnvironment?.Status === TargetStatus.Running
    }

    // The account's environments for this action.
    protected abstract TargetsFor(targets: AccountTargets): readonly EnvironmentTarget[]

    // The choice the confirm button resolves; undefined while not ready.
    protected abstract ChoiceFor(environment: EnvironmentTarget): TargetChoice | undefined

    // A new environment was selected (load is the generation it belongs to).
    protected OnEnvironmentSelected(_environment: EnvironmentTarget | undefined, _load: number): void
    {
    }

    // The choice remembered last time, for the action-specific fields (the graph).
    protected get LastChoice(): TargetChoice | undefined { return this.lastChoice }

    // True while `load` is still the picker's current load (not superseded, not closed).
    protected IsCurrent(load: number): boolean
    {
        return load === this.generation
    }

    protected RefreshCanConfirm(): void
    {
        this.confirmCommand.RaiseCanExecuteChanged()
    }

    protected SetMessage(value: string): void
    {
        if (value === this.message) return
        const old = this.message
        this.message = value
        this.RaisePropertyChanged(TargetDialogProperty.Message, old, value)
        this.RaisePropertyChanged(TargetDialogProperty.HasMessage, old !== '', value !== '')
    }

    protected SetBusy(value: boolean): void
    {
        if (value === this.isBusy) return
        this.isBusy = value
        this.RaisePropertyChanged(TargetDialogProperty.IsBusy, !value, value)
        this.RefreshCanConfirm()
    }

    // A failed load: signed out reads as the sign-in prompt, anything else as its sentence.
    protected ShowFailure(error: unknown): void
    {
        if (error instanceof AccountError && error.Kind === AccountErrorKind.SignedOut)
        {
            this.ShowSignedOut()
            return
        }
        this.SetMessage(TargetDialog.SentenceFor(error))
    }

    // The only text a failure may put on screen: an AccountError's or RelayError's sentence, else
    // one fixed sentence.
    public static SentenceFor(error: unknown): string
    {
        return error instanceof AccountError || error instanceof RelayError ? error.message : TargetDialog.Unexpected
    }

    private static StatusSentence(environment: EnvironmentTarget | undefined): string
    {
        if (environment === undefined || environment.Status === TargetStatus.Running) return ''
        return environment.Status === TargetStatus.Stopped ? TargetDialog.Stopped : TargetDialog.NotRunning
    }

    private static ErrorName(error: unknown): string
    {
        return error instanceof Error ? error.name : typeof error
    }

    private async Load(): Promise<void>
    {
        const load = ++this.generation
        this.SetEnvironments([])
        this.SelectedEnvironment = undefined
        if (!this.account.State.SignedIn)
        {
            this.ShowSignedOut()
            return
        }
        this.SetNeedsSignIn(false)
        this.SetMessage('')
        this.SetBusy(true)
        let targets: AccountTargets
        let last: TargetChoice | undefined
        try
        {
            targets = await this.account.Targets()
            last = await this.account.LastChoice(this.Kind).catch(() => undefined)
        }
        catch (e)
        {
            if (this.IsCurrent(load))
            {
                this.SetBusy(false)
                this.ShowFailure(e)
            }
            return
        }
        if (!this.IsCurrent(load)) return
        this.SetBusy(false)
        const environments = [...this.TargetsFor(targets)]
        this.SetEnvironments(environments)
        if (environments.length === 0)
        {
            this.SetMessage(this.NoEnvironmentsSentence)
            return
        }
        this.lastChoice = last
        this.SelectedEnvironment = environments.find((e) => e.Name === last?.Environment) ?? environments[0]
    }

    private ShowSignedOut(): void
    {
        this.SetEnvironments([])
        this.SelectedEnvironment = undefined
        this.SetNeedsSignIn(true)
        this.SetMessage(this.SignInSentence)
    }

    private Confirm(): void
    {
        const environment = this.selectedEnvironment
        if (environment === undefined || !this.IsReady()) return
        const choice = this.ChoiceFor(environment)
        if (choice === undefined) return
        this.account.RememberChoice(this.Kind, choice).catch((e: unknown) => console.warn(TargetDialog.RememberFailedLog, TargetDialog.ErrorName(e)))
        this.dialogs.Close(choice)
    }

    private SetEnvironments(value: EnvironmentTarget[]): void
    {
        if (value.length === 0 && this.environments.length === 0) return
        const old = this.environments
        this.environments = value
        this.RaisePropertyChanged(TargetDialogProperty.Environments, old, value)
        this.RaisePropertyChanged(TargetDialogProperty.HasEnvironments, old.length > 0, value.length > 0)
    }

    private SetNeedsSignIn(value: boolean): void
    {
        if (value === this.needsSignIn) return
        this.needsSignIn = value
        this.RaisePropertyChanged(TargetDialogProperty.NeedsSignIn, !value, value)
        this.RaisePropertyChanged(TargetDialogProperty.IsSignedIn, value, !value)
        this.RefreshCanConfirm()
    }
}
