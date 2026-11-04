import { Observable, RelayCommand, ServiceKey, type ICommand, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ApplicationSettings, DialogService } from '@pragmatic-tech-ai/mural/framework'
import { CompositeDisposable, type IDisposable } from '@pragmatic-tech-ai/todl-runtime'
import { AccountServiceKey, type IAccountService, type SignInRequest } from '@pragmatic-tech-ai/plexus-core/renderer/modules/account'
import { PlatformAddress } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { AccountDialog } from './account-dialog.js'
import { AccountLabel } from './account-label.js'

// The StatusBar ShellControlDefinition's DataContext: the shell resolves it with provider.get and
// does no class -> Key normalization, so the module hands it this ServiceKey instance.
export const AccountStatusItemKey = new ServiceKey<AccountStatusItem>('AccountStatusItem')

// The account cell in the status bar: "Sign in", or the signed-in email and tenant. Clicking it
// opens the account dialog, as does any UI that calls IAccountService.RequestSignIn(); such a
// request completes when the dialog closes (true when then signed in), or with false at once when
// the dialog cannot open or is already open.
export class AccountStatusItem extends Observable implements IDisposable
{
    public static readonly Key = AccountStatusItemKey
    public static readonly PlatformAddressSetting = 'account.platformAddress'
    private static readonly SignInText = 'Sign in'
    private static readonly TextProperty = 'Text'
    private static readonly DialogTitle = 'Account'
    private static readonly RefreshFailedLog = 'AccountStatusItem: loading the account state failed:'
    private static readonly NoDialogServiceLog = 'AccountStatusItem: no DialogService is registered; the account dialog cannot open.'

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
        this.subscriptions.add(this.account.SignInRequested.subscribe((request) => { void this.OpenDialog(request) }))
        // The account state lives in main; load it once so the cell is right from launch. A failure
        // leaves the cell on "Sign in" and logs only the error's name (never its message).
        this.account.Refresh().catch((e: unknown) => console.warn(AccountStatusItem.RefreshFailedLog, AccountDialog.ErrorName(e)))
    }

    public get Text(): string { return this.text }
    public get OpenCommand(): ICommand { return this.openCommand }

    // Shows the account dialog; a request while it is already open leaves that one in place. A
    // sign-in request is accepted (synchronously, while its signal is handled) only when this call
    // opens the dialog, and completed when the dialog closes.
    public async OpenDialog(request?: SignInRequest): Promise<void>
    {
        if (this.openDialog !== undefined) return
        const dialogs = this.provider.get(DialogService.Key)
        if (dialogs === undefined)
        {
            console.warn(AccountStatusItem.NoDialogServiceLog)
            return
        }
        request?.Accept()
        // DialogService keeps one dialog at a time and Close() takes no handle: it closes whichever
        // dialog is current. A newer Show supersedes (and resolves) this one, which disposes this VM,
        // so in practice its close callback only runs while it is the current dialog.
        const dialog = new AccountDialog(this.account, this.PlatformAddress(), () => dialogs.Close(undefined))
        this.openDialog = dialog
        try
        {
            await dialogs.Show({ Title: AccountStatusItem.DialogTitle, Content: dialog })
        }
        finally
        {
            dialog.dispose()
            this.openDialog = undefined
            request?.Complete(this.account.State.SignedIn)
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
        return state.SignedIn ? AccountLabel.Of(state) : AccountStatusItem.SignInText
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
