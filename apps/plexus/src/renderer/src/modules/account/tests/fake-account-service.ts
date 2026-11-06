import { Signal } from '@pragmatic-tech-ai/todl-runtime'
import { SignInRequest, type IAccountService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/account'
import { PlatformAccess } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type {
    AccountState, AccountTargets, DiscoveredTenant, TargetChoice, TargetKind,
} from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'

// A pending promise the test settles by hand (a sign-in waiting in the browser).
export class Deferred<T>
{
    public readonly Promise: Promise<T>
    public Resolve!: (value: T) => void
    public Reject!: (error: unknown) => void

    public constructor()
    {
        this.Promise = new Promise<T>((resolve, reject) =>
        {
            this.Resolve = resolve
            this.Reject = reject
        })
    }
}

// An in-memory IAccountService: records calls, answers Discover from Tenants (or DiscoverError),
// and holds SignIn open on a Deferred the test settles.
export class FakeAccountService implements IAccountService
{
    public readonly Changed = new Signal<void>()
    public readonly SignInRequested = new Signal<SignInRequest>()
    public readonly Calls: unknown[][] = []
    public Tenants: DiscoveredTenant[] = []
    public DiscoverError: unknown = undefined
    public SignInGate = new Deferred<void>()
    // When set, SignInAtPlatform waits on it (the platform browser sign-in) before applying SignedIn.
    public PlatformGate: Deferred<void> | undefined = undefined
    // The Platform access a discovery sign-in reports (Offered when the tenant has platform environments).
    public SignInPlatform: PlatformAccess | undefined = undefined
    public RefreshCount = 0

    private state: AccountState = { SignedIn: false }

    public get State(): AccountState
    {
        return this.state
    }

    public SetState(state: AccountState): void
    {
        this.state = state
        this.Changed.emit()
    }

    public async Refresh(): Promise<void>
    {
        this.RefreshCount++
    }

    public RequestSignIn(): Promise<boolean>
    {
        return SignInRequest.Raise(this.SignInRequested)
    }

    public async Discover(platformUrl: string, email: string): Promise<DiscoveredTenant[]>
    {
        this.Calls.push(['Discover', platformUrl, email])
        if (this.DiscoverError !== undefined) throw this.DiscoverError
        return this.Tenants
    }

    public async SignIn(platformUrl: string, email: string, tenantId: string): Promise<void>
    {
        this.Calls.push(['SignIn', platformUrl, email, tenantId])
        await this.SignInGate.Promise
        const tenant = this.Tenants.find((t) => t.Id === tenantId)
        this.SetState({ SignedIn: true, Email: email, TenantName: tenant?.DisplayName, Platform: this.SignInPlatform })
    }

    public async SignInAtPlatform(): Promise<void>
    {
        this.Calls.push(['SignInAtPlatform'])
        if (this.PlatformGate !== undefined) await this.PlatformGate.Promise
        this.SetState({ ...this.State, Platform: PlatformAccess.SignedIn })
    }

    public async SignInAtConsole(consoleUrl: string, email: string): Promise<void>
    {
        this.Calls.push(['SignInAtConsole', consoleUrl, email])
        await this.SignInGate.Promise
        this.SetState({ SignedIn: true, Email: email, TenantName: this.Tenants[0]?.DisplayName })
    }

    public async CancelSignIn(): Promise<void>
    {
        this.Calls.push(['CancelSignIn'])
    }

    public async SignOut(): Promise<void>
    {
        this.Calls.push(['SignOut'])
        this.SetState({ SignedIn: false })
    }

    public async Targets(): Promise<AccountTargets>
    {
        return { Contribute: [], Publish: [] }
    }

    public async LastChoice(_kind: TargetKind): Promise<TargetChoice | undefined>
    {
        return undefined
    }

    public async RememberChoice(_kind: TargetKind, _choice: TargetChoice): Promise<void>
    {
    }

    public CallNames(): string[]
    {
        return this.Calls.map((c) => c[0] as string)
    }
}
