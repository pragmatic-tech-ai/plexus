import { Observable, RelayCommand, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import type { DialogService } from '@pragmatic-tech-ai/mural/framework'
import type { IDisposable } from '@pragmatic-tech-ai/todl-runtime'
import type { IAccountService } from '../../account/account-service.js'
import {
    AccountError, AccountErrorKind, RelayError, TargetStatus,
    type AccountTargets, type EnvironmentTarget, type TargetChoice, type TargetKind,
} from '../../../../shared/account-api.js'

// How a picker closed.
export enum TargetPickOutcome
{
    Chosen = 'chosen',
    Cancelled = 'cancelled',
    // The maker pressed Sign in: the picker closed so the account dialog can open in its place.
    SignIn = 'sign-in',
}

export type TargetPick =
    | { Outcome: TargetPickOutcome.Chosen; Choice: TargetChoice }
    | { Outcome: TargetPickOutcome.Cancelled | TargetPickOutcome.SignIn }

// Asks the maker where a contribute or publish goes.
export interface ITargetPicker
{
    Show(): Promise<TargetPick>;
    // Opens the account dialog; resolves once it closes, true when the account is then signed in.
    RequestSignIn(): Promise<boolean>;
}

// The contributors' use of a picker: show it; when the maker asks to sign in, wait for the account
// dialog and show the picker again if they are now signed in (else stop quietly).
export class TargetPickerFlow
{
    public static async Choose(picker: ITargetPicker): Promise<TargetChoice | undefined>
    {
        for (;;)
        {
            const pick = await picker.Show()
            if (pick.Outcome === TargetPickOutcome.Chosen) return pick.Choice
            if (pick.Outcome === TargetPickOutcome.Cancelled) return undefined
            if (!await picker.RequestSignIn()) return undefined
        }
    }
}

// One environment offered in the picker. Label is the ComboBox display text (mural's ComboBox shows
// an item's Label): the name, with the status when it is not running.
export class EnvironmentChoice extends Observable
{
    private static readonly StatusSuffixes: Readonly<Record<TargetStatus, string>> = {
        [TargetStatus.Running]: '',
        [TargetStatus.Stopped]: ' (stopped)',
        [TargetStatus.Failed]: ' (failed)',
        [TargetStatus.Unknown]: ' (status unknown)',
    }

    public constructor(public readonly Target: EnvironmentTarget)
    {
        super()
    }

    public get Name(): string { return this.Target.Name }
    public get Status(): TargetStatus { return this.Target.Status }
    public get IsRunning(): boolean { return this.Target.Status === TargetStatus.Running }

    public get Label(): string
    {
        return `${this.Target.Name}${EnvironmentChoice.StatusSuffixes[this.Target.Status] ?? ''}`
    }

    public toString(): string
    {
        return this.Label
    }
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
// Signed out, it offers a Sign in button that closes the picker with the SignIn outcome (DialogService
// shows one dialog at a time; TargetPickerFlow opens the account dialog and re-shows the picker).
// While open it reloads whenever the account changes. Only an AccountError or RelayError sentence
// (or one fixed sentence) is ever shown as Message.
export abstract class TargetDialog extends Observable implements ITargetPicker
{
    private static readonly Unexpected = 'Something went wrong. Try again.'
    private static readonly Stopped = 'This environment is stopped. Start it from the tenant console.'
    private static readonly NotRunning = 'This environment is not running. Check it in the tenant console.'
    private static readonly RememberFailedLog = 'TargetDialog: remembering the chosen environment failed:'
    private static readonly CancelledPick: TargetPick = { Outcome: TargetPickOutcome.Cancelled }
    private static readonly SignInPick: TargetPick = { Outcome: TargetPickOutcome.SignIn }
    // The ComboBoxes stretch, so without a width the dialog would take the whole window (as
    // InfoDialog and the connection editor, the width is set here, never in .mu).
    private static readonly DialogWidth = 420

    protected readonly account: IAccountService
    private readonly dialogs: DialogService
    private readonly signInCommand: RelayCommand
    private readonly cancelCommand: RelayCommand
    private readonly confirmCommand: RelayCommand

    private environments: EnvironmentChoice[] = []
    private selectedEnvironment: EnvironmentChoice | undefined = undefined
    private message = ''
    private needsSignIn = false
    private isBusy = false
    private lastChoice: TargetChoice | undefined = undefined
    // Bumped by every load and on close, so an answer arriving after a newer load (or after the
    // picker closed) is dropped.
    private generation = 0
    // Bumped by every Show, so a superseded Show's cleanup leaves the newer one's load alone.
    private showSerial = 0

    protected constructor(account: IAccountService, dialogs: DialogService)
    {
        super()
        this.account = account
        this.dialogs = dialogs
        this.signInCommand = new RelayCommand(() => this.dialogs.Close(TargetDialog.SignInPick))
        this.cancelCommand = new RelayCommand(() => this.dialogs.Close(TargetDialog.CancelledPick))
        this.confirmCommand = new RelayCommand(() => this.Confirm(), () => this.IsReady())
    }

    // The dialog title.
    protected abstract get Title(): string
    // Which action this picker chooses for (its targets list and its remembered choice).
    protected abstract get Kind(): TargetKind
    // What the maker is told when signed out, and when the account has no environment for the action.
    protected abstract get SignInSentence(): string
    protected abstract get NoEnvironmentsSentence(): string

    public get Environments(): readonly EnvironmentChoice[] { return this.environments }
    public get HasEnvironments(): boolean { return this.environments.length > 0 }

    public get SelectedEnvironment(): EnvironmentChoice | undefined { return this.selectedEnvironment }
    public set SelectedEnvironment(value: EnvironmentChoice | undefined)
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

    // Opens the picker on DialogService and loads the targets; resolves how it closed (a close by
    // the dialog's X, the scrim or a newer dialog reads as Cancelled).
    public async Show(): Promise<TargetPick>
    {
        const show = ++this.showSerial
        const changed: IDisposable = this.account.Changed.subscribe(() => { void this.Load() })
        const shown = this.dialogs.Show<TargetPick>({ Title: this.Title, Content: this, Width: TargetDialog.DialogWidth })
        void this.Load()
        try
        {
            return (await shown) ?? TargetDialog.CancelledPick
        }
        finally
        {
            changed.dispose()
            if (show === this.showSerial)
            {
                this.generation++
                this.SetBusy(false)
            }
        }
    }

    public RequestSignIn(): Promise<boolean>
    {
        return this.account.RequestSignIn()
    }

    // A signed-in, running environment is chosen (and whatever else the action needs).
    protected IsReady(): boolean
    {
        return !this.needsSignIn && !this.isBusy && this.selectedEnvironment?.IsRunning === true
    }

    // The account's environments for this action.
    protected abstract TargetsFor(targets: AccountTargets): readonly EnvironmentTarget[]

    // The choice the confirm button resolves; undefined while not ready.
    protected abstract ChoiceFor(environment: EnvironmentChoice): TargetChoice | undefined

    // A new environment was selected (load is the generation it belongs to).
    protected OnEnvironmentSelected(_environment: EnvironmentChoice | undefined, _load: number): void
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

    private static StatusSentence(environment: EnvironmentChoice | undefined): string
    {
        if (environment === undefined || environment.IsRunning) return ''
        return environment.Status === TargetStatus.Stopped ? TargetDialog.Stopped : TargetDialog.NotRunning
    }

    private static ErrorName(error: unknown): string
    {
        return error instanceof Error ? error.name : typeof error
    }

    private async Load(): Promise<void>
    {
        const load = ++this.generation
        // A load still in flight was just superseded: its busy flag is this load's to set.
        this.SetBusy(false)
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
        const environments = this.TargetsFor(targets).map((t) => new EnvironmentChoice(t))
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
        this.SetBusy(false)
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
        this.dialogs.Close({ Outcome: TargetPickOutcome.Chosen, Choice: choice } satisfies TargetPick)
    }

    private SetEnvironments(value: EnvironmentChoice[]): void
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
