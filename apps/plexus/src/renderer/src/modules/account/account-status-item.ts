import { Observable, RelayCommand, ServiceKey, type ICommand, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ApplicationSettings, DialogService } from '@pragmatic-tech-ai/mural/framework'
import { CompositeDisposable, type IDisposable } from '@pragmatic-tech-ai/todl-runtime'
import { AccountServiceKey, type IAccountService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/account'
import { PlatformAddress } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { AccountDialog } from './account-dialog.js'

// The StatusBar ShellControlDefinition's DataContext: the shell resolves it with provider.get and
// does no class -> Key normalization, so the module hands it this ServiceKey instance.
export const AccountStatusItemKey = new ServiceKey<AccountStatusItem>('AccountStatusItem')

// The account cell in the status bar: "Sign in", or the signed-in email and tenant. Clicking it
// opens the account dialog, as does any UI that calls IAccountService.RequestSignIn().
export class AccountStatusItem extends Observable implements IDisposable
{
    public static readonly Key = AccountStatusItemKey
    public static readonly PlatformAddressSetting = 'account.platformAddress'
    private static readonly SignInText = 'Sign in'
    private static readonly TextProperty = 'Text'
    private static readonly DialogTitle = 'Account'
    private static readonly DialogWidth = 420

    private readonly provider: IServiceProvider
    private readonly account: IAccountService
    private readonly openCommand: RelayCommand
    private readonly subscriptions = new CompositeDisposable()
    private openDialog: AccountDialog | undefined = undefined
    private text: string

    public constructor(provider: IServiceProvider)
    {
        super()
        this.provider = provider
        this.account = provider.getRequired(AccountServiceKey)
        this.text = this.TextFor()
        this.openCommand = new RelayCommand(() => { void this.OpenDialog() })
        this.subscriptions.add(this.account.Changed.subscribe(() => this.OnAccountChanged()))
        this.subscriptions.add(this.account.SignInRequested.subscribe(() => { void this.OpenDialog() }))
        // The account state lives in main; load it once so the cell is right from launch. A failure
        // leaves the cell on "Sign in".
        this.account.Refresh().catch(() => undefined)
    }

    public get Text(): string { return this.text }
    public get OpenCommand(): ICommand { return this.openCommand }

    // Shows the account dialog; a request while it is already open leaves that one in place.
    public async OpenDialog(): Promise<void>
    {
        if (this.openDialog !== undefined) return
        const dialogs = this.provider.get(DialogService.Key)
        if (dialogs === undefined) return
        const dialog = new AccountDialog(this.account, this.PlatformAddress(), () => dialogs.Close(undefined))
        this.openDialog = dialog
        try
        {
            await dialogs.Show({ Title: AccountStatusItem.DialogTitle, Content: dialog, Width: AccountStatusItem.DialogWidth })
        }
        finally
        {
            dialog.dispose()
            this.openDialog = undefined
        }
    }

    public dispose(): void
    {
        this.subscriptions.dispose()
    }

    // The "Platform address" setting, or the default when it is unset or blank.
    private PlatformAddress(): string
    {
        const value = this.provider.get(ApplicationSettings.Key)?.Get<unknown>(AccountStatusItem.PlatformAddressSetting)
        return typeof value === 'string' && value.trim() !== '' ? value.trim() : PlatformAddress.Default
    }

    private TextFor(): string
    {
        const state = this.account.State
        if (!state.SignedIn) return AccountStatusItem.SignInText
        const email = state.Email ?? ''
        return state.TenantName === undefined || state.TenantName === '' ? email : `${email} (${state.TenantName})`
    }

    private OnAccountChanged(): void
    {
        const next = this.TextFor()
        if (next === this.text) return
        const old = this.text
        this.text = next
        this.RaisePropertyChanged(AccountStatusItem.TextProperty, old, next)
    }
}

export default AccountStatusItem
