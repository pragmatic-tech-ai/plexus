// Shared (renderer + main) contract for the Plexus account: sign in by email through the system
// browser, the signed-in state, the environments the account may contribute or publish to, and the
// last environment picked per action. The desktop session token lives only in the main process;
// nothing in these types ever carries it.

export enum AccountChannel
{
    State = 'account:state',
    Discover = 'account:discover',
    SignIn = 'account:sign-in',
    CancelSignIn = 'account:cancel-sign-in',
    SignOut = 'account:sign-out',
    Targets = 'account:targets',
    LastChoice = 'account:last-choice',
    RememberChoice = 'account:remember-choice',
    Changed = 'account:changed',
}

// What the renderer may know about the account. Never a token.
export type AccountState = { SignedIn: boolean; Email?: string; TenantName?: string }

export type DiscoveredTenant = { Id: string; DisplayName: string }

// Mirrors the server's environment status wire values.
export enum TargetStatus
{
    Running = 'running',
    Stopped = 'stopped',
    Failed = 'failed',
    Unknown = 'unknown',
}

export type EnvironmentTarget = { Name: string; Status: TargetStatus }

export type AccountTargets = { Contribute: EnvironmentTarget[]; Publish: EnvironmentTarget[] }

export enum TargetKind
{
    Contribute = 'contribute',
    Publish = 'publish',
}

export type TargetChoice = { Environment: string; GraphName?: string }

// The Platform address setting: where Plexus asks which tenant an email belongs to. https is
// accepted anywhere; cleartext http only for a loopback host.
export class PlatformAddress
{
    public static readonly Default = 'http://localhost:7000'
    private static readonly SecureScheme = 'https:'
    private static readonly CleartextScheme = 'http:'
    private static readonly LoopbackHosts: readonly string[] = ['localhost', '127.0.0.1', '[::1]']
    private static readonly Malformed = 'The Platform address is not a valid web address.'
    private static readonly BadScheme = 'The Platform address must start with https://.'
    private static readonly Cleartext = 'The Platform address must use https://; plain http:// is only allowed for localhost.'

    // Returns a plain sentence describing what is wrong, or undefined when the address is usable.
    public static Validate(url: string): string | undefined
    {
        let parsed: URL
        try
        {
            parsed = new URL(url.trim())
        }
        catch
        {
            return PlatformAddress.Malformed
        }
        if (parsed.protocol === PlatformAddress.SecureScheme) return undefined
        if (parsed.protocol !== PlatformAddress.CleartextScheme) return PlatformAddress.BadScheme
        if (!PlatformAddress.LoopbackHosts.includes(parsed.hostname)) return PlatformAddress.Cleartext
        return undefined
    }
}

export enum AccountErrorKind
{
    NoAccount = 'no-account',
    Unreachable = 'unreachable',
    SignInFailed = 'sign-in-failed',
    TimedOut = 'timed-out',
    Cancelled = 'cancelled',
    SignedOut = 'signed-out',
    Unavailable = 'unavailable',
}

// An account failure the user can act on. The message is a fixed plain sentence per kind, so it
// can never carry a URL, a token or a raw server answer.
export class AccountError extends Error
{
    private static readonly ErrorName = 'AccountError'
    private static readonly Messages: Readonly<Record<AccountErrorKind, string>> = {
        [AccountErrorKind.NoAccount]: 'No account was found for this email.',
        [AccountErrorKind.Unreachable]: 'The platform could not be reached. Check the Platform address in Settings.',
        [AccountErrorKind.SignInFailed]: 'Sign-in did not finish. Try again.',
        [AccountErrorKind.TimedOut]: 'Sign-in was not finished in the browser. Try again.',
        [AccountErrorKind.Cancelled]: 'Sign-in was cancelled.',
        [AccountErrorKind.SignedOut]: "You're signed out. Sign in and try again.",
        [AccountErrorKind.Unavailable]: 'Sign-in is not available right now. Try again later.',
    }

    public constructor(public readonly Kind: AccountErrorKind)
    {
        super(AccountError.Messages[Kind])
        this.name = AccountError.ErrorName
    }

    public static IsKind(value: unknown): value is AccountErrorKind
    {
        return Object.values(AccountErrorKind).includes(value as AccountErrorKind)
    }

    // Recovers an AccountError after a hop that keeps only an Error's message (Electron's context
    // bridge drops the class and custom fields of a thrown error). Each kind's sentence is unique, so
    // the message names the kind. Anything else answers undefined.
    public static From(error: unknown): AccountError | undefined
    {
        if (error instanceof AccountError) return error
        if (!(error instanceof Error)) return undefined
        const kind = Object.values(AccountErrorKind).find(k => error.message.endsWith(AccountError.Messages[k]))
        return kind === undefined ? undefined : new AccountError(kind)
    }
}

// How an account error crosses IPC: only its kind.
export type AccountWireError = { Kind: AccountErrorKind }

// The envelope every account IPC handler answers with, so an AccountError survives the hop (Electron
// only carries an Error's message across ipc.handle, prefixed and unparseable).
export type AccountReply<T> = { Ok: true; Value: T } | { Ok: false; Error: AccountWireError }

export class AccountWire
{
    // Runs the work and wraps its outcome. Anything that is not an AccountError becomes Unavailable,
    // so no other error text (which could name a path or address) reaches the renderer.
    public static async Capture<T>(work: () => Promise<T>): Promise<AccountReply<T>>
    {
        try
        {
            return { Ok: true, Value: await work() }
        }
        catch (e)
        {
            return { Ok: false, Error: { Kind: e instanceof AccountError ? e.Kind : AccountErrorKind.Unavailable } }
        }
    }

    // Unwraps a reply on the renderer side, rebuilding the AccountError.
    public static Unwrap<T>(reply: AccountReply<T>): T
    {
        if (reply.Ok) return reply.Value
        throw new AccountError(AccountError.IsKind(reply.Error.Kind) ? reply.Error.Kind : AccountErrorKind.Unavailable)
    }
}

export interface IAccountApi
{
    State(): Promise<AccountState>;
    // The tenants the email has an account in (a chooser is shown when there are several).
    Discover(platformUrl: string, email: string): Promise<DiscoveredTenant[]>;
    // Opens the system browser on the tenant's sign-in page and resolves once it is finished there.
    SignIn(platformUrl: string, email: string, tenantId: string): Promise<AccountState>;
    CancelSignIn(): Promise<void>;
    SignOut(): Promise<AccountState>;
    Targets(): Promise<AccountTargets>;
    LastChoice(kind: TargetKind): Promise<TargetChoice | undefined>;
    RememberChoice(kind: TargetKind, choice: TargetChoice): Promise<void>;
    OnChanged(cb: (s: AccountState) => void): () => void;
}
