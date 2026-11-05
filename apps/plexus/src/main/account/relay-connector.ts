import { ConnectionLostError, ErrorCodes, ResponseError, type PragmaticClient } from '@pragmatic-tech-ai/pragmatic-protocol'
import { AccountError, AccountErrorKind, UrlBase, type TargetKind } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { TlsFailure } from '../net/system-trust.js'
import type { DesktopSession } from './desktop-session-store.js'

// The methods the contribute and publish flows call on a relay connection (PragmaticClient has them).
export type RelayClient = Pick<PragmaticClient, 'ListGraphs' | 'ContributeGraph' | 'DeployApplication' | 'DisposeAsync'>

// Opens the connection: production is PragmaticClient.ConnectAsync(url, { bearerToken: token }).
export type RelayDial = (url: string, token: string) => Promise<RelayClient>

// The slice of AccountService the connector needs (AccountService satisfies it).
export interface IRelaySessionSource
{
    Session(): Promise<DesktopSession | undefined>;
    // Clears the session holding `token`, only while it is still the stored one.
    HandleSignedOut(token: string): Promise<void>;
}

export interface IRelayConnector
{
    Connect(environment: string, kind: TargetKind): Promise<RelayClient>;
}

// The HTTP answers the tenant plane refuses a relay upgrade with.
enum RelayStatus
{
    Unauthorized = 401,
    Forbidden = 403,
    Conflict = 409,
}

// Reads the HTTP status of a refused relay upgrade. ws reports a non-101 answer only as an Error whose
// message is "Unexpected server response: <status>" (PragmaticClient.ConnectAsync passes it through),
// so the message is parsed here and nowhere else; a numeric statusCode/status on the error wins when
// present.
export class RelayRefusal
{
    private static readonly UnexpectedResponse = /^Unexpected server response: (\d{3})$/

    public static StatusOf(error: unknown): number | undefined
    {
        if (!(error instanceof Error)) return undefined
        const { statusCode, status } = error as { statusCode?: unknown; status?: unknown }
        if (typeof statusCode === 'number') return statusCode
        if (typeof status === 'number') return status
        const match = RelayRefusal.UnexpectedResponse.exec(error.message)
        return match === null ? undefined : Number(match[1])
    }
}

// Tells a relay that went away mid-call (signed out elsewhere, environment stopped, a 1008 close)
// from an answer the environment's server gave. A drop surfaces as the protocol client's
// ConnectionLostError, a vscode-jsonrpc ResponseError with a transport code (pending response
// rejected, write/read failure, inactive), or a vscode-jsonrpc ConnectionError (an Error, not a
// ResponseError, whose numeric code is Closed = 1 or Disposed = 2). Server JSON-RPC errors (conflict,
// not found, -32601) are ResponseErrors with other codes and are not drops.
export class RelayDrop
{
    private static readonly TransportCodes: readonly number[] = [
        ErrorCodes.PendingResponseRejected, ErrorCodes.MessageWriteError, ErrorCodes.MessageReadError, ErrorCodes.ConnectionInactive,
    ]
    // vscode-jsonrpc ConnectionErrors.Closed and ConnectionErrors.Disposed.
    private static readonly ConnectionErrorCodes: readonly number[] = [1, 2]

    public static Is(error: unknown): boolean
    {
        if (error instanceof ConnectionLostError) return true
        if (error instanceof ResponseError) return RelayDrop.TransportCodes.includes(error.code)
        if (!(error instanceof Error)) return false
        const { code } = error as { code?: unknown }
        return typeof code === 'number' && RelayDrop.ConnectionErrorCodes.includes(code)
    }
}

// Tells a server's own answer (a conflict, a not-found, a refused parameter: a ResponseError whose
// message the server wrote for the user) from a protocol-level failure whose text is JSON-RPC
// plumbing ("Method not found", a parse error, "server not initialized") or from any other error
// thrown on this side. Only a server's own answer keeps its message.
export class RelayAnswer
{
    private static readonly ProtocolCodes: readonly number[] = [
        ErrorCodes.ParseError, ErrorCodes.MethodNotFound, ErrorCodes.ServerNotInitialized, ErrorCodes.UnknownErrorCode,
    ]

    public static IsServerAnswer(error: unknown): boolean
    {
        return error instanceof ResponseError && !RelayAnswer.ProtocolCodes.includes(error.code)
    }
}

// Opens a JSON-RPC connection to an environment through the desktop relay of the session's console
// (a tenant's own console, or the platform's tenant plane), which mints and keeps the environment
// credential server-side. Plexus presents only the desktop session token.
// Every failure becomes a fixed sentence (naming at most the environment): never a URL, a token or
// the underlying transport text. A 401 means the session is over, so the account is cleared.
export class RelayConnector implements IRelayConnector
{
    private static readonly RelayPath = '/desktop/relay'
    private static readonly EnvironmentParam = 'environment'
    private static readonly ActionParam = 'action'
    private static readonly SocketSchemes: Readonly<Record<string, string>> = { 'http:': 'ws:', 'https:': 'wss:' }
    private static readonly BadConsole = 'The console address is not usable.'
    private static readonly NotAllowed = "Your account can't use this environment."
    private static readonly EnvironmentPrefix = 'The environment '
    private static readonly NotRunningSuffix = ' is not running. Start it from the tenant console.'
    private static readonly UnreachableSuffix = ' could not be reached.'
    private static readonly NotHandledSuffix = ' could not handle this request. It may need an update.'

    public constructor(private readonly sessions: IRelaySessionSource, private readonly dial: RelayDial)
    {
    }

    public async Connect(environment: string, kind: TargetKind): Promise<RelayClient>
    {
        const session = await this.LoadSession()
        if (session === undefined) throw new AccountError(AccountErrorKind.SignedOut)
        let url: string
        try
        {
            url = RelayConnector.RelayUrl(session.ConsoleUrl, environment, kind)
        }
        catch
        {
            throw RelayConnector.Unreachable(environment)
        }
        try
        {
            return await this.dial(url, session.Token)
        }
        catch (e)
        {
            // Only installing the certificate fixes this, so it is named rather than called unreachable.
            if (TlsFailure.IsCertificate(e)) throw new AccountError(AccountErrorKind.CertificateUntrusted)
            throw await this.Refusal(RelayRefusal.StatusOf(e), environment, session.Token)
        }
    }

    // An account failure (secure storage gone) keeps its kind; any other failure to read the stored
    // session (a file-system error naming its path) becomes the fixed Unavailable sentence.
    private async LoadSession(): Promise<DesktopSession | undefined>
    {
        try
        {
            return await this.sessions.Session()
        }
        catch (e)
        {
            if (e instanceof AccountError) throw e
            throw new AccountError(AccountErrorKind.Unavailable)
        }
    }

    // ws(s)://<console>/desktop/relay?environment=<name>&action=<kind>. Encoded by hand so a space is
    // %20 (URLSearchParams would write +). A base path is kept for sessions saved with a tenant plane
    // address that had one.
    public static RelayUrl(consoleUrl: string, environment: string, kind: TargetKind): string
    {
        const address = new URL(consoleUrl)
        const scheme = RelayConnector.SocketSchemes[address.protocol]
        if (scheme === undefined) throw new Error(RelayConnector.BadConsole)
        const base = UrlBase.Of(address.pathname)
        const query = `${RelayConnector.EnvironmentParam}=${encodeURIComponent(environment)}&${RelayConnector.ActionParam}=${encodeURIComponent(kind)}`
        return `${scheme}//${address.host}${base}${RelayConnector.RelayPath}?${query}`
    }

    private async Refusal(status: number | undefined, environment: string, token: string): Promise<Error>
    {
        switch (status)
        {
            case RelayStatus.Unauthorized:
                await this.ForgetSession(token)
                return new AccountError(AccountErrorKind.SignedOut)
            case RelayStatus.Forbidden:
                return new Error(RelayConnector.NotAllowed)
            case RelayStatus.Conflict:
                return new Error(`${RelayConnector.EnvironmentPrefix}${environment}${RelayConnector.NotRunningSuffix}`)
            default:
                return RelayConnector.Unreachable(environment)
        }
    }

    // A failure to clear the local copy must not replace the SignedOut answer the user acts on.
    private async ForgetSession(token: string): Promise<void>
    {
        try
        {
            await this.sessions.HandleSignedOut(token)
        }
        catch
        {
            // the next relay or targets call meets the same 401 and tries again
        }
    }

    // Runs a call on an open relay: a relay that went away mid-call becomes the unreachable sentence;
    // the server's own answer (and an account failure) is rethrown as is; anything else (a JSON-RPC
    // protocol error such as -32601 Method not found, or an error raised on this side) becomes a
    // fixed sentence naming only the environment.
    public static async Call<T>(environment: string, work: () => Promise<T>): Promise<T>
    {
        try
        {
            return await work()
        }
        catch (e)
        {
            if (RelayDrop.Is(e)) throw RelayConnector.Unreachable(environment)
            if (e instanceof AccountError || RelayAnswer.IsServerAnswer(e)) throw e
            throw new Error(`${RelayConnector.EnvironmentPrefix}${environment}${RelayConnector.NotHandledSuffix}`)
        }
    }

    private static Unreachable(environment: string): Error
    {
        return new Error(`${RelayConnector.EnvironmentPrefix}${environment}${RelayConnector.UnreachableSuffix}`)
    }
}
