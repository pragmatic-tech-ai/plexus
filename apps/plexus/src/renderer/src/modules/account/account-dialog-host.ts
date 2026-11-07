import { ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ApplicationSettings, DialogService } from '@pragmatic-tech-ai/mural/framework'
import type { IDisposable } from '@pragmatic-tech-ai/todl-runtime'
import { AccountServiceKey, type IAccountService, type SignInRequest } from '@pragmatic-tech-ai/plexus-core/renderer/modules/account'
import { PlatformAddress } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { AccountDialog } from './account-dialog.js'
import { ConsoleAddressSetting } from './console-address-setting.js'

// Opens the account dialog: for the status-bar cell's click, and for every
// IAccountService.RequestSignIn() (a picker's Sign in). It owns the SignInRequested subscription, and
// AccountSignInModule constructs it when the module loads, so a sign-in request is answered from boot
// whether or not the status bar has been built. A request completes when the dialog closes (true
// when then signed in), or with false at once when the dialog cannot open or is already open.
export class AccountDialogHost implements IDisposable
{
    public static readonly Key = new ServiceKey<AccountDialogHost>('AccountDialogHost')
    public static readonly PlatformAddressSetting = 'account.platformAddress'
    private static readonly DialogTitle = 'Account'
    private static readonly OpenFailedLog = 'AccountDialogHost: opening the account dialog failed:'
    private static readonly RefreshFailedLog = 'AccountDialogHost: loading the account state failed:'
    private static readonly NoDialogServiceLog = 'AccountDialogHost: no DialogService is registered; the account dialog cannot open.'

    private readonly provider: IServiceProvider
    private readonly account: IAccountService
    private readonly requests: IDisposable
    private openDialog: AccountDialog | undefined = undefined

    public constructor(provider: IServiceProvider)
    {
        this.provider = provider
        this.account = provider.getRequired(AccountServiceKey)
        this.requests = this.account.SignInRequested.subscribe((request) => { void this.OpenDialog(request) })
        // The account state lives in main; load it once at launch so the status cell and the pickers
        // are right from boot. A failure leaves the account signed out.
        this.Refresh()
    }

    // Shows the account dialog; a request while it is already open leaves that one in place. A
    // sign-in request is accepted (synchronously, while its signal is handled) only when this call
    // opens the dialog, and completed when the dialog closes. A dialog opened for a request closes by
    // itself once the sign-in succeeds, so the picker that asked comes back without an extra click.
    public async OpenDialog(request?: SignInRequest): Promise<void>
    {
        if (this.openDialog !== undefined) return
        const dialogs = this.provider.get(DialogService.Key)
        if (dialogs === undefined)
        {
            console.warn(AccountDialogHost.NoDialogServiceLog)
            return
        }
        let dialog: AccountDialog | undefined
        try
        {
            request?.Accept()
            // DialogService keeps one dialog at a time and Close() takes no handle: it closes whichever
            // dialog is current. A newer Show supersedes (and resolves) this one, which disposes this
            // VM, so in practice its close callback only runs while it is the current dialog.
            dialog = new AccountDialog(this.account, this.PlatformAddress(),
                new ConsoleAddressSetting(this.provider.get(ApplicationSettings.Key)), () => dialogs.Close(undefined), request !== undefined)
            this.openDialog = dialog
            // Main may have moved on without a push (it treats an expired platform part as absent):
            // reload the state, and the open dialog follows it on Changed.
            this.Refresh()
            await dialogs.Show({ Title: AccountDialogHost.DialogTitle, Content: dialog })
        }
        catch (e)
        {
            // Only the error's name is logged: never its message, which could carry an address.
            console.warn(AccountDialogHost.OpenFailedLog, AccountDialog.ErrorName(e))
        }
        finally
        {
            dialog?.dispose()
            this.openDialog = undefined
            // An accepted request always completes, even when the dialog could not be built.
            request?.Complete(this.account.State.SignedIn)
        }
    }

    // The account dialog while it is shown, else undefined. Read by the e2e scripted sign-in, which
    // drives the dialog's view model instead of clicking its SVG.
    public get CurrentDialog(): AccountDialog | undefined
    {
        return this.openDialog
    }

    public dispose(): void
    {
        this.requests.dispose()
    }

    // Reloads the account state from main without waiting for it. A failure keeps the state as it was
    // and logs only the error's name (never its message).
    private Refresh(): void
    {
        this.account.Refresh().catch((e: unknown) => console.warn(AccountDialogHost.RefreshFailedLog, AccountDialog.ErrorName(e)))
    }

    // The "Platform address" setting, or the default when it is unset or blank.
    private PlatformAddress(): string
    {
        const value = this.provider.get(ApplicationSettings.Key)?.Get<unknown>(AccountDialogHost.PlatformAddressSetting)
        return typeof value === 'string' && value.trim() !== '' ? value.trim() : PlatformAddress.Default
    }
}

export default AccountDialogHost
