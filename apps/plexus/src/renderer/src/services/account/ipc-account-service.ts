import { Signal, type IDisposable } from '@pragmatic-tech-ai/todl-runtime'
import { AccountServiceKey, type IAccountService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/account'
import { AccountWire } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type {
    AccountState, AccountTargets, DiscoveredTenant, IAccountBridge, TargetChoice, TargetKind,
} from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'

// The renderer-side account service: the concrete IAccountService resolved through AccountServiceKey.
// A thin wrapper over the preload bridge (window.api.account) that unwraps each AccountReply, so a
// failure rejects with an AccountError carrying its Kind. State follows the account:changed pushes.
export class IpcAccountService implements IAccountService, IDisposable
{
    public static readonly Key = AccountServiceKey

    private static readonly BridgeUnavailable =
        'IpcAccountService: window.api.account is unavailable - the Electron preload '
        + 'bridge did not load. This service requires a desktop host.'

    public readonly Changed = new Signal<void>()
    public readonly SignInRequested = new Signal<void>()

    private state: AccountState = { SignedIn: false }
    private readonly api: IAccountBridge
    private readonly releaseChanged: () => void

    constructor()
    {
        const bridge = (globalThis as unknown as { api?: { account?: IAccountBridge } }).api
        if (bridge?.account === undefined)
        {
            throw new Error(IpcAccountService.BridgeUnavailable)
        }
        this.api = bridge.account
        this.releaseChanged = this.api.OnChanged((s) => this.Apply(s))
    }

    public get State(): AccountState
    {
        return this.state
    }

    public async Refresh(): Promise<void>
    {
        this.Apply(AccountWire.Unwrap(await this.api.State()))
    }

    public RequestSignIn(): void
    {
        this.SignInRequested.emit()
    }

    public async Discover(platformUrl: string, email: string): Promise<DiscoveredTenant[]>
    {
        return AccountWire.Unwrap(await this.api.Discover(platformUrl, email))
    }

    public async SignIn(platformUrl: string, email: string, tenantId: string): Promise<void>
    {
        this.Apply(AccountWire.Unwrap(await this.api.SignIn(platformUrl, email, tenantId)))
    }

    public async CancelSignIn(): Promise<void>
    {
        AccountWire.Unwrap(await this.api.CancelSignIn())
    }

    public async SignOut(): Promise<void>
    {
        this.Apply(AccountWire.Unwrap(await this.api.SignOut()))
    }

    public async Targets(): Promise<AccountTargets>
    {
        return AccountWire.Unwrap(await this.api.Targets())
    }

    public async LastChoice(kind: TargetKind): Promise<TargetChoice | undefined>
    {
        return AccountWire.Unwrap(await this.api.LastChoice(kind))
    }

    public async RememberChoice(kind: TargetKind, choice: TargetChoice): Promise<void>
    {
        AccountWire.Unwrap(await this.api.RememberChoice(kind, choice))
    }

    public dispose(): void
    {
        this.releaseChanged()
    }

    // The sign-in reply and main's account:changed push both carry the new state; Changed fires only
    // when the state actually differs, so one operation raises it once.
    private Apply(state: AccountState): void
    {
        const current = this.state
        if (current.SignedIn === state.SignedIn && current.Email === state.Email && current.TenantName === state.TenantName)
        {
            return
        }
        this.state = state
        this.Changed.emit()
    }
}

export default IpcAccountService
