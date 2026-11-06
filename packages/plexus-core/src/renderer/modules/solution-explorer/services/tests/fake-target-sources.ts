import { Signal } from '@pragmatic-tech-ai/todl-runtime'
import { SignInRequest, type IAccountService } from '../../../account/account-service.js'
import type { IGraphContributor } from '../../../graph-contribute/graph-contributor.js'
import type {
    AccountState, AccountTargets, DiscoveredTenant, TargetChoice, TargetKind,
} from '../../../../../shared/account-api.js'
import type { ContributedPackage, GraphContributeResult } from '../../../../../shared/graph-contribute-api.js'
import { TargetPickOutcome, type ITargetPicker, type TargetPick } from '../target-dialog.js'

// A pending promise the test settles by hand.
export class Gate<T>
{
    public readonly Promise: Promise<T>
    public Resolve!: (value: T) => void

    public constructor()
    {
        this.Promise = new Promise<T>((resolve) => { this.Resolve = resolve })
    }
}

// An in-memory IAccountService for the target pickers: answers Targets / LastChoice from fields
// (or throws TargetsError, or waits on TargetsGate) and records RememberChoice / RequestSignIn.
// RequestSignIn goes through SignInRequest.Raise; the fake's own listener plays the account module:
// it accepts each request and completes it with SignInResult (the account dialog closing).
export class FakeTargetAccount implements IAccountService
{
    public readonly Changed = new Signal<void>()
    public readonly SignInRequested = new Signal<SignInRequest>()
    public SignInResult = false
    public TargetsGate: Gate<void> | undefined = undefined
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
        this.SignInRequested.subscribe((request) =>
        {
            this.SignInRequests++
            request.Accept()
            request.Complete(this.SignInResult)
        })
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

    public RequestSignIn(): Promise<boolean>
    {
        return SignInRequest.Raise(this.SignInRequested)
    }

    public async Discover(_platformUrl: string, _email: string): Promise<DiscoveredTenant[]>
    {
        return []
    }

    public async SignIn(_platformUrl: string, _email: string, _tenantId: string): Promise<void>
    {
    }

    public async SignInAtConsole(_consoleUrl: string, _email: string): Promise<void>
    {
    }

    public async SignInAtPlatform(): Promise<void>
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
        if (this.TargetsGate !== undefined) await this.TargetsGate.Promise
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
    public ListGate: Gate<void> | undefined = undefined
    public readonly Listed: string[] = []

    public async Contribute(_environment: string, graphName: string, _solutionId: string, packages: ContributedPackage[]): Promise<GraphContributeResult>
    {
        return { GraphName: graphName, PackageCount: packages.length }
    }

    public async ListGraphs(environment: string): Promise<string[]>
    {
        this.Listed.push(environment)
        if (this.ListGate !== undefined) await this.ListGate.Promise
        if (this.ListError !== undefined) throw this.ListError
        return this.Graphs[environment] ?? []
    }
}

// A DialogService stand-in: Show stays open until Close, which settles it with the value. Like
// DialogService, a newer Show first closes the open one with undefined.
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
        this.Close(undefined)
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

// An ITargetPicker that answers Show from a script of picks (an Error rejects), in order, and
// RequestSignIn from SignInResult. Counts both calls.
export class ScriptedPicker implements ITargetPicker
{
    public Shows = 0
    public SignInRequests = 0
    public SignInResult = false

    public constructor(private readonly picks: Array<TargetPick | Error>)
    {
    }

    // A pick for a plain answer: a choice is Chosen, undefined is Cancelled.
    public static PickOf(input: TargetChoice | undefined | Error): TargetPick | Error
    {
        if (input instanceof Error) return input
        return input === undefined ? { Outcome: TargetPickOutcome.Cancelled } : { Outcome: TargetPickOutcome.Chosen, Choice: input }
    }

    public Show(): Promise<TargetPick>
    {
        const pick = this.picks[Math.min(this.Shows, this.picks.length - 1)]!
        this.Shows++
        return pick instanceof Error ? Promise.reject(pick) : Promise.resolve(pick)
    }

    public async RequestSignIn(): Promise<boolean>
    {
        this.SignInRequests++
        return this.SignInResult
    }
}
