import { Observable, RelayCommand, ServiceKey, type ICommand, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { CompositeDisposable, type IDisposable } from '@pragmatic-tech-ai/todl-runtime'
import { AccountServiceKey, type IAccountService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/account'
import { AccountDialogHost } from './account-dialog-host.js'
import { AccountLabel } from './account-label.js'

// The StatusBar ShellControlDefinition's DataContext: the shell resolves it with provider.get and
// does no class -> Key normalization, so the module hands it this ServiceKey instance.
export const AccountStatusItemKey = new ServiceKey<AccountStatusItem>('AccountStatusItem')

// The account cell in the status bar: "Sign in", or the signed-in email and tenant. Clicking it
// opens the account dialog through AccountDialogHost, which (not this cell) also answers
// IAccountService.RequestSignIn().
export class AccountStatusItem extends Observable implements IDisposable
{
    public static readonly Key = AccountStatusItemKey
    private static readonly SignInText = 'Sign in'
    private static readonly TextProperty = 'Text'

    private readonly account: IAccountService
    private readonly openCommand: RelayCommand
    private readonly subscriptions = new CompositeDisposable()
    private text: string

    public constructor(provider: IServiceProvider)
    {
        super()
        this.account = provider.getRequired(AccountServiceKey)
        const host = provider.getRequired(AccountDialogHost.Key)
        this.text = this.TextFor()
        this.openCommand = new RelayCommand(() => { void host.OpenDialog() })
        // The launch state load is AccountDialogHost's (built at module load); the cell follows Changed.
        this.subscriptions.add(this.account.Changed.subscribe(() => this.OnAccountChanged()))
    }

    public get Text(): string { return this.text }
    public get OpenCommand(): ICommand { return this.openCommand }

    public dispose(): void
    {
        this.subscriptions.dispose()
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
