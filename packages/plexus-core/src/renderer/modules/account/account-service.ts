import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { Signal } from '@pragmatic-tech-ai/todl-runtime'
import type { AccountState, AccountTargets, DiscoveredTenant, TargetChoice, TargetKind } from '../../../shared/account-api.js'

// One request, raised through IAccountService.SignInRequested, for the account dialog to open. The
// listener that opens the dialog calls Accept() while handling the signal and Complete(signedIn)
// once the dialog closes; a request nobody accepts completes with false. Completing twice is a no-op.
export class SignInRequest
{
    public readonly Done: Promise<boolean>
    private resolve!: (signedIn: boolean) => void
    private accepted = false
    private completed = false

    public constructor()
    {
        this.Done = new Promise<boolean>((resolve) => { this.resolve = resolve })
    }

    public get IsAccepted(): boolean { return this.accepted }
    public get IsCompleted(): boolean { return this.completed }

    public Accept(): void
    {
        this.accepted = true
    }

    public Complete(signedIn: boolean): void
    {
        if (this.completed) return
        this.completed = true
        this.resolve(signedIn)
    }

    // Raises a request on `signal` and resolves once it completes (false at once when not accepted).
    public static Raise(signal: Signal<SignInRequest>): Promise<boolean>
    {
        const request = new SignInRequest()
        signal.emit(request)
        if (!request.IsAccepted) request.Complete(false)
        return request.Done
    }
}

// Host-agnostic account capability: the signed-in state, email sign-in through the system browser,
// and the environments the account may contribute or publish to. The desktop host (apps/plexus)
// supplies the impl over its preload bridge; the session token never reaches the renderer.
export interface IAccountService
{
    readonly State: AccountState;
    // Raised once whenever State changes.
    readonly Changed: Signal<void>;
    // Raised when some UI asks the user to sign in; the account module opens its dialog and
    // completes the request when that dialog closes.
    readonly SignInRequested: Signal<SignInRequest>;
    Refresh(): Promise<void>;
    // Asks for the account dialog; resolves once it closes, true when the account is then signed
    // in. Resolves false at once when no dialog could open (none listening, or one already open).
    RequestSignIn(): Promise<boolean>;
    Discover(platformUrl: string, email: string): Promise<DiscoveredTenant[]>;
    SignIn(platformUrl: string, email: string, tenantId: string): Promise<void>;
    SignInAtConsole(consoleUrl: string, email: string): Promise<void>;
    CancelSignIn(): Promise<void>;
    SignOut(): Promise<void>;
    Targets(): Promise<AccountTargets>;
    LastChoice(kind: TargetKind): Promise<TargetChoice | undefined>;
    RememberChoice(kind: TargetKind, choice: TargetChoice): Promise<void>;
}

export const AccountServiceKey = new ServiceKey<IAccountService>('AccountService')
