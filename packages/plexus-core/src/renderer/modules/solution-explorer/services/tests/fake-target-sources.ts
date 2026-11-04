import { Signal } from '@pragmatic-tech-ai/todl-runtime'
import type { IAccountService } from '../../../account/account-service.js'
import type { IGraphContributor } from '../../../graph-contribute/graph-contributor.js'
import type {
    AccountState, AccountTargets, DiscoveredTenant, TargetChoice, TargetKind,
} from '../../../../../shared/account-api.js'
import type { ContributedPackage, GraphContributeResult } from '../../../../../shared/graph-contribute-api.js'

// An in-memory IAccountService for the target pickers: answers Targets / LastChoice from fields
// (or throws TargetsError) and records RememberChoice / RequestSignIn.
export class FakeTargetAccount implements IAccountService
{
    public readonly Changed = new Signal<void>()
    public readonly SignInRequested = new Signal<void>()
    public TargetList: AccountTargets = { Contribute: [], Publish: [] }
    public TargetsError: unknown = undefined
    public Last: Partial<Record<TargetKind, TargetChoice>> = {}
    public readonly Remembered: Array<[TargetKind, TargetChoice]> = []
    public SignInRequests = 0
    public TargetsCalls = 0

    private state: AccountState

    public constructor(signedIn: boolean)
    {
        this.state = signedIn ? { SignedIn: true, Email: 'ann@acme.test', TenantName: 'Acme' } : { SignedIn: false }
        this.SignInRequested.subscribe(() => { this.SignInRequests++ })
    }

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
    }

    public RequestSignIn(): void
    {
        this.SignInRequested.emit()
    }

    public async Discover(_platformUrl: string, _email: string): Promise<DiscoveredTenant[]>
    {
        return []
    }

    public async SignIn(_platformUrl: string, _email: string, _tenantId: string): Promise<void>
    {
    }

    public async CancelSignIn(): Promise<void>
    {
    }

    public async SignOut(): Promise<void>
    {
    }

    public async Targets(): Promise<AccountTargets>
    {
        this.TargetsCalls++
        if (this.TargetsError !== undefined) throw this.TargetsError
        return this.TargetList
    }

    public async LastChoice(kind: TargetKind): Promise<TargetChoice | undefined>
    {
        return this.Last[kind]
    }

    public async RememberChoice(kind: TargetKind, choice: TargetChoice): Promise<void>
    {
        this.Remembered.push([kind, choice])
    }
}

// An IGraphContributor whose ListGraphs answers from a per-environment map (or throws ListError).
export class FakeGraphSource implements IGraphContributor
{
    public Graphs: Record<string, string[]> = {}
    public ListError: unknown = undefined
    public readonly Listed: string[] = []

    public async Contribute(_environment: string, graphName: string, _solutionId: string, packages: ContributedPackage[]): Promise<GraphContributeResult>
    {
        return { GraphName: graphName, PackageCount: packages.length }
    }

    public async ListGraphs(environment: string): Promise<string[]>
    {
        this.Listed.push(environment)
        if (this.ListError !== undefined) throw this.ListError
        return this.Graphs[environment] ?? []
    }
}

// A DialogService stand-in: Show stays open until Close, which settles it with the value.
export class FakePickerDialogs
{
    public readonly Shown: Array<{ Title: string | undefined; Content: unknown }> = []
    private settle: ((value: unknown) => void) | undefined = undefined

    public get IsOpen(): boolean
    {
        return this.settle !== undefined
    }

    public Show<T>(options: { Title?: string; Content: unknown }): Promise<T | undefined>
    {
        this.Shown.push({ Title: options.Title, Content: options.Content })
        return new Promise<T | undefined>((resolve) => { this.settle = resolve as (value: unknown) => void })
    }

    public Close(value?: unknown): void
    {
        const settle = this.settle
        this.settle = undefined
        settle?.(value)
    }

    // Lets the picker's async loads finish.
    public static Flush(): Promise<void>
    {
        return new Promise((res) => setTimeout(res, 0))
    }
}
