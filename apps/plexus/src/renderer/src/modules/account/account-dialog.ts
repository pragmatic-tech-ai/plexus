import { Observable, RelayCommand, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import type { IDisposable } from '@pragmatic-tech-ai/todl-runtime'
import type { IAccountService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/account'
import {
    AccountError, AccountErrorKind, ConsoleAddress, PlatformAccess, PlatformAddress, type DiscoveredTenant,
} from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { AccountLabel } from './account-label.js'
import { AccountDialogStep } from './account-dialog-step.js'
import type { IConsoleAddressSetting } from './console-address-setting.js'

export { AccountDialogStep }

// The bindable property names the dialog raises PropertyChanged for.
enum AccountDialogProperty
{
    Step = 'Step',
    IsEmailStep = 'IsEmailStep',
    IsChooseTenantStep = 'IsChooseTenantStep',
    IsWaitingStep = 'IsWaitingStep',
    IsSignedInStep = 'IsSignedInStep',
    IsPlatformOfferStep = 'IsPlatformOfferStep',
    ShowsPlatformOffer = 'ShowsPlatformOffer',
    ShowsPlatformSignedIn = 'ShowsPlatformSignedIn',
    Email = 'Email',
    Tenants = 'Tenants',
    SelectedTenant = 'SelectedTenant',
    Message = 'Message',
    HasMessage = 'HasMessage',
    IsBusy = 'IsBusy',
    SignedInText = 'SignedInText',
    UseConsoleAddress = 'UseConsoleAddress',
    ShowsUseConsoleLink = 'ShowsUseConsoleLink',
    ConsoleAddress = 'ConsoleAddress',
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
// A discovery sign-in for a tenant that also has platform environments (State.Platform Offered)
// stops on PlatformOffer first: sign in once more at the platform (Waiting -> SignedIn), or Skip.
// The Platform address is the Settings value read when the dialog opened; an invalid one is
// reported with PlatformAddress.Validate's sentence before anything reaches the main process.
// Only AccountError sentences (or one fixed sentence) are ever shown as Message.
export class AccountDialog extends Observable implements IDisposable
{
    private static readonly Unexpected = 'Something went wrong. Try again.'
    private static readonly SignedInPrefix = 'Signed in as '
    private static readonly RememberFailedLog = 'AccountDialog: saving the console address setting failed:'
    private static readonly CancelFailedLog = 'AccountDialog: cancelling the pending sign-in on close failed:'

    private readonly account: IAccountService
    private readonly platformAddress: string
    private readonly consoleAddressSetting: IConsoleAddressSetting
    private readonly close: () => void
    private readonly closeOnSignIn: boolean
    private readonly changed: IDisposable
    private readonly continueCommand: RelayCommand
    private readonly cancelCommand: RelayCommand
    private readonly signOutCommand: RelayCommand
    private readonly useConsoleAddressCommand: RelayCommand
    private readonly usePlatformCommand: RelayCommand
    private readonly platformSignInCommand: RelayCommand
    private readonly skipPlatformCommand: RelayCommand

    private step: AccountDialogStep
    // Set while Waiting is the platform sign-in (a Cancel then returns to SignedIn, not Email).
    private waitingOnPlatform = false
    private email = ''
    private tenants: TenantChoice[] = []
    private selectedTenant: TenantChoice | undefined = undefined
    private message = ''
    private useConsoleAddress = false
    private consoleAddress = ''
    private isBusy = false
    // Bumped whenever a pending sign-in is abandoned (Cancel / dispose), so its late answer is ignored.
    private signInGeneration = 0
    // Set once the dialog has closed: a discovery answering afterwards must not start a sign-in.
    private disposed = false

    // `close` dismisses the host dialog. `closeOnSignIn` (set when the dialog was opened for a
    // sign-in request, e.g. a picker's Sign in) closes it as soon as its own sign-in succeeds, so the
    // picker comes back without an extra click; otherwise it stays open on "Signed in as".
    public constructor(account: IAccountService, platformAddress: string, consoleAddress: IConsoleAddressSetting,
        close: () => void, closeOnSignIn = false)
    {
        super()
        this.account = account
        this.platformAddress = platformAddress
        this.consoleAddressSetting = consoleAddress
        this.consoleAddress = consoleAddress.Value
        this.useConsoleAddress = this.consoleAddress !== ''
        this.close = close
        this.closeOnSignIn = closeOnSignIn
        const state = account.State
        this.step = state.SignedIn ? AccountDialogStep.SignedIn : AccountDialogStep.Email
        this.email = state.Email ?? ''
        this.continueCommand = new RelayCommand(() => { void this.Continue() }, () => this.CanContinue)
        this.cancelCommand = new RelayCommand(() => { void this.Cancel() })
        this.signOutCommand = new RelayCommand(() => { void this.SignOut() }, () => !this.isBusy)
        this.useConsoleAddressCommand = new RelayCommand(() => this.SetUseConsoleAddress(true))
        this.usePlatformCommand = new RelayCommand(() => this.SetUseConsoleAddress(false))
        this.platformSignInCommand = new RelayCommand(() => { void this.SignInAtPlatform() }, () => this.CanSignInAtPlatform)
        this.skipPlatformCommand = new RelayCommand(() => this.SkipPlatform())
        this.changed = account.Changed.subscribe(() => this.OnAccountChanged())
    }

    public get Step(): AccountDialogStep { return this.step }
    public get IsEmailStep(): boolean { return this.step === AccountDialogStep.Email }
    public get IsChooseTenantStep(): boolean { return this.step === AccountDialogStep.ChooseTenant }
    public get IsWaitingStep(): boolean { return this.step === AccountDialogStep.Waiting }
    public get IsSignedInStep(): boolean { return this.step === AccountDialogStep.SignedIn }
    public get IsPlatformOfferStep(): boolean { return this.step === AccountDialogStep.PlatformOffer }

    // The SignedIn panel's "Also sign in for your platform environments" button.
    public get ShowsPlatformOffer(): boolean
    {
        return this.step === AccountDialogStep.SignedIn && this.account.State.Platform === PlatformAccess.Offered
    }

    // The SignedIn panel's "Also signed in for your platform environments." line.
    public get ShowsPlatformSignedIn(): boolean
    {
        return this.account.State.Platform === PlatformAccess.SignedIn
    }

    public get Email(): string { return this.email }
    public set Email(value: string)
    {
        if (value === this.email) return
        const old = this.email
        this.email = value
        this.RaisePropertyChanged(AccountDialogProperty.Email, old, value)
        this.continueCommand.RaiseCanExecuteChanged()
    }

    public get UseConsoleAddress(): boolean { return this.useConsoleAddress }
    // The "Use a specific console address" link shows while the address field is hidden.
    public get ShowsUseConsoleLink(): boolean { return !this.useConsoleAddress }

    public get ConsoleAddress(): string { return this.consoleAddress }
    public set ConsoleAddress(value: string)
    {
        if (value === this.consoleAddress) return
        const old = this.consoleAddress
        this.consoleAddress = value
        this.RaisePropertyChanged(AccountDialogProperty.ConsoleAddress, old, value)
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
        return `${AccountDialog.SignedInPrefix}${AccountLabel.Of(this.account.State)}`
    }

    public get ContinueCommand(): ICommand { return this.continueCommand }
    public get CancelCommand(): ICommand { return this.cancelCommand }
    public get SignOutCommand(): ICommand { return this.signOutCommand }
    public get UseConsoleAddressCommand(): ICommand { return this.useConsoleAddressCommand }
    public get UsePlatformCommand(): ICommand { return this.usePlatformCommand }
    public get PlatformSignInCommand(): ICommand { return this.platformSignInCommand }
    public get SkipPlatformCommand(): ICommand { return this.skipPlatformCommand }

    private get CanContinue(): boolean
    {
        if (this.isBusy) return false
        if (this.step === AccountDialogStep.Email) return this.email.trim() !== ''
        if (this.step === AccountDialogStep.ChooseTenant) return this.selectedTenant !== undefined
        return false
    }

    // The platform sign-in is offered on PlatformOffer, and on SignedIn while the offer still shows.
    private get CanSignInAtPlatform(): boolean
    {
        if (this.isBusy) return false
        return this.IsPlatformOfferStep || this.ShowsPlatformOffer
    }

    // Email: ask which tenants the email belongs to. ChooseTenant: sign in to the chosen one.
    public async Continue(): Promise<void>
    {
        if (this.isBusy) return
        if (this.step === AccountDialogStep.Email)
        {
            if (this.useConsoleAddress) await this.SignInAtConsole()
            else await this.DiscoverTenants()
        }
        else if (this.step === AccountDialogStep.ChooseTenant && this.selectedTenant !== undefined)
        {
            await this.SignInTo(this.selectedTenant.Id)
        }
    }

    // While waiting on the browser: abandon the sign-in and go back to Email (to SignedIn when it was
    // the platform sign-in, which leaves the discovery sign-in in place). Otherwise: close.
    public async Cancel(): Promise<void>
    {
        if (this.step !== AccountDialogStep.Waiting)
        {
            this.close()
            return
        }
        this.signInGeneration++
        const back = this.waitingOnPlatform ? AccountDialogStep.SignedIn : AccountDialogStep.Email
        this.waitingOnPlatform = false
        this.SetBusy(false)
        this.SetMessage('')
        this.SetStep(back)
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
        // Only the error's name is logged: never its message, which could carry an address.
        this.account.CancelSignIn().catch((e: unknown) => console.warn(AccountDialog.CancelFailedLog, AccountDialog.ErrorName(e)))
    }

    // The only text a failure may put on screen: an AccountError's fixed sentence, else one fixed sentence.
    public static SentenceFor(error: unknown): string
    {
        return error instanceof AccountError ? error.message : AccountDialog.Unexpected
    }

    // A loggable name for a failure: the Error's name, never its message.
    public static ErrorName(error: unknown): string
    {
        return error instanceof Error ? error.name : typeof error
    }

    // Signs in straight at the typed tenant console; nothing reaches main unless the address is valid.
    private async SignInAtConsole(): Promise<void>
    {
        const email = this.email.trim()
        if (email === '')
        {
            this.SetMessage(new AccountError(AccountErrorKind.InvalidEmail).message)
            return
        }
        const invalid = ConsoleAddress.Validate(this.consoleAddress)
        if (invalid !== undefined)
        {
            this.SetMessage(new AccountError(invalid).message)
            return
        }
        const address = this.consoleAddress.trim()
        const generation = ++this.signInGeneration
        this.SetMessage('')
        this.SetStep(AccountDialogStep.Waiting)
        this.SetBusy(true)
        try
        {
            await this.account.SignInAtConsole(address, email)
            if (generation !== this.signInGeneration) return
            this.SaveSetting(() => this.consoleAddressSetting.Remember(ConsoleAddress.Normalise(address)))
            this.SetStep(AccountDialogStep.SignedIn)
            if (this.closeOnSignIn) this.close()
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

    // A failure to save the remembered address must not look like a failed sign-in; only the
    // error's name is logged.
    private SaveSetting(save: () => void): void
    {
        try
        {
            save()
        }
        catch (e)
        {
            console.warn(AccountDialog.RememberFailedLog, AccountDialog.ErrorName(e))
        }
    }

    private SetUseConsoleAddress(value: boolean): void
    {
        if (value === this.useConsoleAddress) return
        this.useConsoleAddress = value
        this.RaisePropertyChanged(AccountDialogProperty.UseConsoleAddress, !value, value)
        this.RaisePropertyChanged(AccountDialogProperty.ShowsUseConsoleLink, value, !value)
        this.SetMessage('')
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
            this.SaveSetting(() => this.consoleAddressSetting.Forget())
            // The tenant also has platform environments: offer that sign-in before finishing (and
            // before closing, so a sign-in request is answered once the offer is taken or skipped).
            if (this.account.State.Platform === PlatformAccess.Offered)
            {
                this.SetStep(AccountDialogStep.PlatformOffer)
                return
            }
            this.SetStep(AccountDialogStep.SignedIn)
            if (this.closeOnSignIn) this.close()
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

    // PlatformOffer / SignedIn: sign in once more, at the platform's tenant plane. A failure shows its
    // sentence on SignedIn (the discovery sign-in still stands).
    private async SignInAtPlatform(): Promise<void>
    {
        if (!this.CanSignInAtPlatform) return
        const generation = ++this.signInGeneration
        this.SetMessage('')
        this.waitingOnPlatform = true
        this.SetStep(AccountDialogStep.Waiting)
        this.SetBusy(true)
        try
        {
            await this.account.SignInAtPlatform()
            if (generation !== this.signInGeneration) return
            this.waitingOnPlatform = false
            this.SetStep(AccountDialogStep.SignedIn)
            if (this.closeOnSignIn) this.close()
        }
        catch (e)
        {
            if (generation !== this.signInGeneration) return
            this.waitingOnPlatform = false
            this.SetMessage(AccountDialog.SentenceFor(e))
            this.SetStep(this.account.State.SignedIn ? AccountDialogStep.SignedIn : AccountDialogStep.Email)
        }
        finally
        {
            if (generation === this.signInGeneration) this.SetBusy(false)
        }
    }

    // PlatformOffer: finish without the platform sign-in (the offer stays on the SignedIn panel).
    private SkipPlatform(): void
    {
        if (this.step !== AccountDialogStep.PlatformOffer) return
        this.SetStep(AccountDialogStep.SignedIn)
        if (this.closeOnSignIn) this.close()
    }

    // A sign-in or sign-out from elsewhere moves the dialog to match, except mid-sign-in. PlatformOffer
    // is left only on a sign-out (-> Email) or once the platform is no longer Offered (-> SignedIn).
    private OnAccountChanged(): void
    {
        this.RaisePropertyChanged(AccountDialogProperty.SignedInText, undefined, this.SignedInText)
        this.RaisePlatformChanged()
        if (this.step === AccountDialogStep.Waiting) return
        if (this.step === AccountDialogStep.PlatformOffer)
        {
            if (!this.account.State.SignedIn) this.SetStep(AccountDialogStep.Email)
            else if (this.account.State.Platform !== PlatformAccess.Offered) this.SetStep(AccountDialogStep.SignedIn)
            return
        }
        if (this.account.State.SignedIn)
        {
            this.SetMessage('')
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
        this.RaisePropertyChanged(AccountDialogProperty.IsPlatformOfferStep, undefined, this.IsPlatformOfferStep)
        this.RaisePropertyChanged(AccountDialogProperty.SignedInText, undefined, this.SignedInText)
        this.RaisePlatformChanged()
        this.continueCommand.RaiseCanExecuteChanged()
    }

    private RaisePlatformChanged(): void
    {
        this.RaisePropertyChanged(AccountDialogProperty.ShowsPlatformOffer, undefined, this.ShowsPlatformOffer)
        this.RaisePropertyChanged(AccountDialogProperty.ShowsPlatformSignedIn, undefined, this.ShowsPlatformSignedIn)
        this.platformSignInCommand.RaiseCanExecuteChanged()
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
        this.platformSignInCommand.RaiseCanExecuteChanged()
    }
}

export default AccountDialog
