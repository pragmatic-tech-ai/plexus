// Shared (renderer + main) contract for the Plexus account: sign in by email through the system
// browser, the signed-in state, the environments the account may contribute or publish to, and the
// last environment picked per action. The desktop session token lives only in the main process;
// nothing in these types ever carries it.

export enum AccountChannel
{
    State = 'account:state',
    Discover = 'account:discover',
    SignIn = 'account:sign-in',
    SignInAtConsole = 'account:sign-in-at-console',
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
    public static readonly LoopbackHosts: readonly string[] = ['localhost', '127.0.0.1', '[::1]']
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

// The address of an organization's own tenant console, typed by the user. A bare origin only:
// https anywhere, cleartext http only for a loopback host; no credentials, path, query or fragment.
export class ConsoleAddress
{
    private static readonly SecureScheme = 'https:'
    private static readonly CleartextScheme = 'http:'
    private static readonly RootPath = '/'

    // undefined when usable, else AccountErrorKind.ConsoleAddressInvalid.
    public static Validate(url: string): AccountErrorKind | undefined
    {
        let parsed: URL
        try
        {
            parsed = new URL(url.trim())
        }
        catch
        {
            return AccountErrorKind.ConsoleAddressInvalid
        }
        const schemeOk = parsed.protocol === ConsoleAddress.SecureScheme
            || (parsed.protocol === ConsoleAddress.CleartextScheme && PlatformAddress.LoopbackHosts.includes(parsed.hostname))
        const bare = parsed.username === '' && parsed.password === '' && parsed.search === ''
            && parsed.hash === '' && parsed.pathname === ConsoleAddress.RootPath
        return schemeOk && bare ? undefined : AccountErrorKind.ConsoleAddressInvalid
    }

    // The origin of a valid address: scheme and host lowercased, port kept, no trailing slash.
    public static Normalise(url: string): string
    {
        return new URL(url.trim()).origin
    }
}

export enum AccountErrorKind
{
    NoAccount = 'no-account',
    InvalidEmail = 'invalid-email',
    Unreachable = 'unreachable',
    SignInFailed = 'sign-in-failed',
    TimedOut = 'timed-out',
    Cancelled = 'cancelled',
    SignedOut = 'signed-out',
    Unavailable = 'unavailable',
    SecureStorageUnavailable = 'secure-storage-unavailable',
    ConsoleAddressInvalid = 'console-address-invalid',
    NotAConsole = 'not-a-console',
    ConsoleUnreachable = 'console-unreachable',
    CertificateUntrusted = 'certificate-untrusted',
}

// An account failure the user can act on. The message is a fixed plain sentence per kind, so it
// can never carry a URL, a token or a raw server answer.
export class AccountError extends Error
{
    private static readonly ErrorName = 'AccountError'
    private static readonly Messages: Readonly<Record<AccountErrorKind, string>> = {
        [AccountErrorKind.NoAccount]: 'No account was found for this email.',
        [AccountErrorKind.InvalidEmail]: "That doesn't look like an email address.",
        [AccountErrorKind.Unreachable]: 'The platform could not be reached. Check the Platform address in Settings.',
        [AccountErrorKind.SignInFailed]: 'Sign-in did not finish. Try again.',
        [AccountErrorKind.TimedOut]: 'Sign-in was not finished in the browser. Try again.',
        [AccountErrorKind.Cancelled]: 'Sign-in was cancelled.',
        [AccountErrorKind.SignedOut]: "You're signed out. Sign in and try again.",
        [AccountErrorKind.Unavailable]: 'Sign-in is not available right now. Try again later.',
        [AccountErrorKind.SecureStorageUnavailable]: "Plexus can't store your sign-in securely on this computer.",
        [AccountErrorKind.ConsoleAddressInvalid]: 'Enter the console address as an https:// web address. Plain http:// works only for this computer.',
        [AccountErrorKind.NotAConsole]: 'That address is not a Pragmatic tenant console.',
        [AccountErrorKind.ConsoleUnreachable]: "Your organization's console could not be reached. Try again later, or check the console address.",
        [AccountErrorKind.CertificateUntrusted]: "This computer doesn't trust the server's certificate. Ask your administrator to install it, then restart Plexus.",
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
}

// How an account error crosses IPC: only its kind.
export type AccountWireError = { Kind: AccountErrorKind }

// The envelope every account IPC handler answers with and the preload bridge resolves to, so an
// AccountError survives both hops (ipc.handle and Electron's context bridge carry only an Error's
// message, dropping its class and Kind; a plain object crosses intact).
export type AccountReply<T> = { Ok: true; Value: T } | { Ok: false; Error: AccountWireError }

export class AccountWire
{
    // Main side: runs the work and wraps its outcome. Anything that is not an AccountError becomes
    // Unavailable, so no other error text (which could name a path or address) reaches the renderer;
    // such an error is first handed to onUnexpected (for a main-process log).
    public static async Capture<T>(work: () => Promise<T>, onUnexpected?: (error: unknown) => void): Promise<AccountReply<T>>
    {
        try
        {
            return { Ok: true, Value: await work() }
        }
        catch (e)
        {
            if (e instanceof AccountError) return { Ok: false, Error: { Kind: e.Kind } }
            onUnexpected?.(e)
            return { Ok: false, Error: { Kind: AccountErrorKind.Unavailable } }
        }
    }

    // Renderer side (behind IAccountBridge): unwraps a reply, rebuilding a failure into an AccountError.
    public static Unwrap<T>(reply: AccountReply<T>): T
    {
        if (reply.Ok) return reply.Value
        throw new AccountError(AccountError.IsKind(reply.Error.Kind) ? reply.Error.Kind : AccountErrorKind.Unavailable)
    }
}

// How a contribute or publish failure crosses IPC: its sentence (relay refusals and server answers
// are plain sentences that never carry a URL or token), plus the account kind when it is one.
export type RelayWireError = { Message: string; Kind?: AccountErrorKind }

// The envelope the graph-contribute and tenant-publish handlers answer with and their preload bridges
// resolve to: ipc.handle would otherwise reject with "Error invoking remote method ..." around the
// sentence, and the context bridge would drop an AccountError's class and Kind.
export type RelayReply<T> = { Ok: true; Value: T } | { Ok: false; Error: RelayWireError }

// A contribute or publish failure rebuilt on the renderer side: its message is the relay's or the
// server's plain sentence, so a picker or task row may show it as is.
export class RelayError extends Error
{
    private static readonly ErrorName = 'RelayError'

    public constructor(message: string)
    {
        super(message)
        this.name = RelayError.ErrorName
    }
}

export class RelayWire
{
    private static readonly Failed = 'The request did not finish. Try again.'

    // Main side. An Error's message is carried as is: the relay connector and the services raise
    // sentences, and the server's own answers (conflict, not found) are kept so the user sees why.
    public static async Capture<T>(work: () => Promise<T>): Promise<RelayReply<T>>
    {
        try
        {
            return { Ok: true, Value: await work() }
        }
        catch (e)
        {
            if (e instanceof AccountError) return { Ok: false, Error: { Message: e.message, Kind: e.Kind } }
            return { Ok: false, Error: { Message: e instanceof Error ? e.message : RelayWire.Failed } }
        }
    }

    // Renderer side: unwraps a reply, rebuilding an account failure into an AccountError and any
    // other failure into a RelayError whose message is the sentence.
    public static Unwrap<T>(reply: RelayReply<T>): T
    {
        if (reply.Ok) return reply.Value
        if (AccountError.IsKind(reply.Error.Kind)) throw new AccountError(reply.Error.Kind)
        throw new RelayError(typeof reply.Error.Message === 'string' ? reply.Error.Message : RelayWire.Failed)
    }
}

// What the preload exposes on window.api.account: every call resolves to its AccountReply envelope
// (never rejects with an account failure), so the renderer seam can rebuild the AccountError with
// AccountWire.Unwrap and present IAccountApi.
export interface IAccountBridge
{
    State(): Promise<AccountReply<AccountState>>;
    Discover(platformUrl: string, email: string): Promise<AccountReply<DiscoveredTenant[]>>;
    SignIn(platformUrl: string, email: string, tenantId: string): Promise<AccountReply<AccountState>>;
    SignInAtConsole(consoleUrl: string, email: string): Promise<AccountReply<AccountState>>;
    CancelSignIn(): Promise<AccountReply<void>>;
    SignOut(): Promise<AccountReply<AccountState>>;
    Targets(): Promise<AccountReply<AccountTargets>>;
    LastChoice(kind: TargetKind): Promise<AccountReply<TargetChoice | undefined>>;
    RememberChoice(kind: TargetKind, choice: TargetChoice): Promise<AccountReply<void>>;
    OnChanged(cb: (s: AccountState) => void): () => void;
}

export interface IAccountApi
{
    State(): Promise<AccountState>;
    // The tenants the email has an account in (a chooser is shown when there are several).
    Discover(platformUrl: string, email: string): Promise<DiscoveredTenant[]>;
    // Opens the system browser on the tenant's sign-in page and resolves once it is finished there.
    SignIn(platformUrl: string, email: string, tenantId: string): Promise<AccountState>;
    // Signs in at an organization's console whose address the user typed.
    SignInAtConsole(consoleUrl: string, email: string): Promise<AccountState>;
    CancelSignIn(): Promise<void>;
    SignOut(): Promise<AccountState>;
    Targets(): Promise<AccountTargets>;
    LastChoice(kind: TargetKind): Promise<TargetChoice | undefined>;
    RememberChoice(kind: TargetKind, choice: TargetChoice): Promise<void>;
    OnChanged(cb: (s: AccountState) => void): () => void;
}
