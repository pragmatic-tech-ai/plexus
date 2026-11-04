import { Observable, RelayCommand, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import type { IDisposable } from '@pragmatic-tech-ai/todl-runtime'
import type { IAccountService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/account'
import {
    AccountError, AccountErrorKind, PlatformAddress, type DiscoveredTenant,
} from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'

// Where the account dialog is in the sign-in flow.
export enum AccountDialogStep
{
    Email = 'email',
    ChooseTenant = 'choose-tenant',
    Waiting = 'waiting',
    SignedIn = 'signed-in',
}

// The bindable property names the dialog raises PropertyChanged for.
enum AccountDialogProperty
{
    Step = 'Step',
    IsEmailStep = 'IsEmailStep',
    IsChooseTenantStep = 'IsChooseTenantStep',
    IsWaitingStep = 'IsWaitingStep',
    IsSignedInStep = 'IsSignedInStep',
    Email = 'Email',
    Tenants = 'Tenants',
    SelectedTenant = 'SelectedTenant',
    Message = 'Message',
    HasMessage = 'HasMessage',
    IsBusy = 'IsBusy',
    SignedInText = 'SignedInText',
}

// One tenant offered in the chooser. toString is the ComboBox display text.
export class TenantChoice extends Observable
{
    public constructor(private readonly tenant: DiscoveredTenant)
    {
        super()
    }

    public get Id(): string { return this.tenant.Id }
    public get DisplayName(): string { return this.tenant.DisplayName }

    public toString(): string
    {
        return this.tenant.DisplayName
    }

    // The tenants ordered by display name, as the chooser lists them.
    public static Sorted(tenants: readonly DiscoveredTenant[]): TenantChoice[]
    {
        return [...tenants]
            .sort((a, b) => a.DisplayName.localeCompare(b.DisplayName))
            .map((t) => new TenantChoice(t))
    }
}

// The account dialog body: email -> (tenant chooser) -> finish in the browser -> signed in.
// The Platform address is the Settings value read when the dialog opened; an invalid one is
// reported with PlatformAddress.Validate's sentence before anything reaches the main process.
// Only AccountError sentences (or one fixed sentence) are ever shown as Message.
export class AccountDialog extends Observable implements IDisposable
{
    private static readonly Unexpected = 'Something went wrong. Try again.'
    private static readonly SignedInPrefix = 'Signed in as '

    private readonly account: IAccountService
    private readonly platformAddress: string
    private readonly close: () => void
    private readonly changed: IDisposable
    private readonly continueCommand: RelayCommand
    private readonly cancelCommand: RelayCommand
    private readonly signOutCommand: RelayCommand

    private step: AccountDialogStep
    private email = ''
    private tenants: TenantChoice[] = []
    private selectedTenant: TenantChoice | undefined = undefined
    private message = ''
    private isBusy = false
    // Bumped whenever a pending sign-in is abandoned (Cancel / dispose), so its late answer is ignored.
    private signInGeneration = 0
    // Set once the dialog has closed: a discovery answering afterwards must not start a sign-in.
    private disposed = false

    // `close` dismisses the host dialog.
    public constructor(account: IAccountService, platformAddress: string, close: () => void)
    {
        super()
        this.account = account
        this.platformAddress = platformAddress
        this.close = close
        const state = account.State
        this.step = state.SignedIn ? AccountDialogStep.SignedIn : AccountDialogStep.Email
        this.email = state.Email ?? ''
        this.continueCommand = new RelayCommand(() => { void this.Continue() }, () => this.CanContinue)
        this.cancelCommand = new RelayCommand(() => { void this.Cancel() })
        this.signOutCommand = new RelayCommand(() => { void this.SignOut() }, () => !this.isBusy)
        this.changed = account.Changed.subscribe(() => this.OnAccountChanged())
    }

    public get Step(): AccountDialogStep { return this.step }
    public get IsEmailStep(): boolean { return this.step === AccountDialogStep.Email }
    public get IsChooseTenantStep(): boolean { return this.step === AccountDialogStep.ChooseTenant }
    public get IsWaitingStep(): boolean { return this.step === AccountDialogStep.Waiting }
    public get IsSignedInStep(): boolean { return this.step === AccountDialogStep.SignedIn }

    public get Email(): string { return this.email }
    public set Email(value: string)
    {
        if (value === this.email) return
        const old = this.email
        this.email = value
        this.RaisePropertyChanged(AccountDialogProperty.Email, old, value)
        this.continueCommand.RaiseCanExecuteChanged()
    }

    public get Tenants(): readonly TenantChoice[] { return this.tenants }

    public get SelectedTenant(): TenantChoice | undefined { return this.selectedTenant }
    public set SelectedTenant(value: TenantChoice | undefined)
    {
        if (value === this.selectedTenant) return
        const old = this.selectedTenant
        this.selectedTenant = value
        this.RaisePropertyChanged(AccountDialogProperty.SelectedTenant, old, value)
        this.continueCommand.RaiseCanExecuteChanged()
    }

    public get Message(): string { return this.message }
    public get HasMessage(): boolean { return this.message !== '' }
    public get IsBusy(): boolean { return this.isBusy }

    public get SignedInText(): string
    {
        const state = this.account.State
        const tenant = state.TenantName === undefined || state.TenantName === '' ? '' : ` (${state.TenantName})`
        return `${AccountDialog.SignedInPrefix}${state.Email ?? ''}${tenant}`
    }

    public get ContinueCommand(): ICommand { return this.continueCommand }
    public get CancelCommand(): ICommand { return this.cancelCommand }
    public get SignOutCommand(): ICommand { return this.signOutCommand }

    private get CanContinue(): boolean
    {
        if (this.isBusy) return false
        if (this.step === AccountDialogStep.Email) return this.email.trim() !== ''
        if (this.step === AccountDialogStep.ChooseTenant) return this.selectedTenant !== undefined
        return false
    }

    // Email: ask which tenants the email belongs to. ChooseTenant: sign in to the chosen one.
    public async Continue(): Promise<void>
    {
        if (this.isBusy) return
        if (this.step === AccountDialogStep.Email)
        {
            await this.DiscoverTenants()
        }
        else if (this.step === AccountDialogStep.ChooseTenant && this.selectedTenant !== undefined)
        {
            await this.SignInTo(this.selectedTenant.Id)
        }
    }

    // While waiting on the browser: abandon the sign-in and go back to Email. Otherwise: close.
    public async Cancel(): Promise<void>
    {
        if (this.step !== AccountDialogStep.Waiting)
        {
            this.close()
            return
        }
        this.signInGeneration++
        this.SetBusy(false)
        this.SetMessage('')
        this.SetStep(AccountDialogStep.Email)
        try
        {
            await this.account.CancelSignIn()
        }
        catch (e)
        {
            this.SetMessage(AccountDialog.SentenceFor(e))
        }
    }

    public async SignOut(): Promise<void>
    {
        if (this.isBusy) return
        this.SetMessage('')
        this.SetBusy(true)
        try
        {
            await this.account.SignOut()
            this.SetStep(AccountDialogStep.Email)
        }
        catch (e)
        {
            this.SetMessage(AccountDialog.SentenceFor(e))
        }
        finally
        {
            this.SetBusy(false)
        }
    }

    // The dialog closed: stop following the account and abandon a sign-in still waiting.
    public dispose(): void
    {
        this.disposed = true
        this.changed.dispose()
        if (this.step !== AccountDialogStep.Waiting) return
        this.signInGeneration++
        this.account.CancelSignIn().catch(() => undefined)
    }

    // The only text a failure may put on screen: an AccountError's fixed sentence, else one fixed sentence.
    public static SentenceFor(error: unknown): string
    {
        return error instanceof AccountError ? error.message : AccountDialog.Unexpected
    }

    private async DiscoverTenants(): Promise<void>
    {
        const invalidAddress = PlatformAddress.Validate(this.platformAddress)
        if (invalidAddress !== undefined)
        {
            this.SetMessage(invalidAddress)
            return
        }
        const email = this.email.trim()
        if (email === '')
        {
            this.SetMessage(new AccountError(AccountErrorKind.InvalidEmail).message)
            return
        }
        this.SetMessage('')
        this.SetBusy(true)
        let found: DiscoveredTenant[]
        try
        {
            found = await this.account.Discover(this.platformAddress, email)
        }
        catch (e)
        {
            this.SetMessage(AccountDialog.SentenceFor(e))
            return
        }
        finally
        {
            this.SetBusy(false)
        }
        if (this.disposed) return
        if (found.length === 0)
        {
            this.SetMessage(new AccountError(AccountErrorKind.NoAccount).message)
            return
        }
        this.SetTenants(TenantChoice.Sorted(found))
        if (this.tenants.length === 1)
        {
            await this.SignInTo(this.tenants[0].Id)
            return
        }
        this.SelectedTenant = this.tenants[0]
        this.SetStep(AccountDialogStep.ChooseTenant)
    }

    private async SignInTo(tenantId: string): Promise<void>
    {
        const generation = ++this.signInGeneration
        this.SetMessage('')
        this.SetStep(AccountDialogStep.Waiting)
        this.SetBusy(true)
        try
        {
            await this.account.SignIn(this.platformAddress, this.email.trim(), tenantId)
            if (generation !== this.signInGeneration) return
            this.SetStep(AccountDialogStep.SignedIn)
        }
        catch (e)
        {
            if (generation !== this.signInGeneration) return
            this.SetMessage(AccountDialog.SentenceFor(e))
            this.SetStep(AccountDialogStep.Email)
        }
        finally
        {
            if (generation === this.signInGeneration) this.SetBusy(false)
        }
    }

    // A sign-in or sign-out from elsewhere moves the dialog to match, except mid-sign-in.
    private OnAccountChanged(): void
    {
        this.RaisePropertyChanged(AccountDialogProperty.SignedInText, undefined, this.SignedInText)
        if (this.step === AccountDialogStep.Waiting) return
        if (this.account.State.SignedIn)
        {
            this.SetStep(AccountDialogStep.SignedIn)
        }
        else if (this.step === AccountDialogStep.SignedIn)
        {
            this.SetStep(AccountDialogStep.Email)
        }
    }

    private SetStep(value: AccountDialogStep): void
    {
        if (value === this.step) return
        const old = this.step
        this.step = value
        this.RaisePropertyChanged(AccountDialogProperty.Step, old, value)
        this.RaisePropertyChanged(AccountDialogProperty.IsEmailStep, undefined, this.IsEmailStep)
        this.RaisePropertyChanged(AccountDialogProperty.IsChooseTenantStep, undefined, this.IsChooseTenantStep)
        this.RaisePropertyChanged(AccountDialogProperty.IsWaitingStep, undefined, this.IsWaitingStep)
        this.RaisePropertyChanged(AccountDialogProperty.IsSignedInStep, undefined, this.IsSignedInStep)
        this.RaisePropertyChanged(AccountDialogProperty.SignedInText, undefined, this.SignedInText)
        this.continueCommand.RaiseCanExecuteChanged()
    }

    private SetTenants(value: TenantChoice[]): void
    {
        const old = this.tenants
        this.tenants = value
        this.RaisePropertyChanged(AccountDialogProperty.Tenants, old, value)
    }

    private SetMessage(value: string): void
    {
        if (value === this.message) return
        const old = this.message
        this.message = value
        this.RaisePropertyChanged(AccountDialogProperty.Message, old, value)
        this.RaisePropertyChanged(AccountDialogProperty.HasMessage, old !== '', value !== '')
    }

    private SetBusy(value: boolean): void
    {
        if (value === this.isBusy) return
        this.isBusy = value
        this.RaisePropertyChanged(AccountDialogProperty.IsBusy, !value, value)
        this.continueCommand.RaiseCanExecuteChanged()
        this.signOutCommand.RaiseCanExecuteChanged()
    }
}

export default AccountDialog
