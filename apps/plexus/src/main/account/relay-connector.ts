import { ConnectionLostError, ErrorCodes, ResponseError, UpgradeRefusedError, type PragmaticClient } from '@pragmatic-tech-ai/pragmatic-protocol'
import { AccountError, AccountErrorKind, TargetSource, UrlBase, type TargetKind, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { TlsFailure } from '../net/system-trust.js'
import { ConsoleRetirement } from './console-retirement.js'
import type { SessionAddress } from './desktop-session-store.js'

// The methods the contribute and publish flows call on a relay connection (PragmaticClient has them).
export type RelayClient = Pick<PragmaticClient, 'ListGraphs' | 'ContributeGraph' | 'DeployApplication' | 'DisposeAsync' | 'CloseCode'>

// Opens the connection: production is PragmaticClient.ConnectAsync(url, { bearerToken: token }).
export type RelayDial = (url: string, token: string) => Promise<RelayClient>

// The slice of AccountService the connector needs (AccountService satisfies it).
export interface IRelaySessionSource
{
    // Where a target of `source` is reached and the token that proves it; undefined when signed out there.
    SessionFor(source: TargetSource): Promise<SessionAddress | undefined>;
    // Clears the session holding `token`, only while it is still the stored one.
    HandleSignedOut(token: string): Promise<void>;
}

export interface IRelayConnector
{
    Connect(target: TargetRef, kind: TargetKind): Promise<RelayClient>;
}

// A call on an open relay: the environment (and graph) it is about, for the sentences, and the client
// whose close code tells a retired console from any other drop.
export type RelayCall = { Environment: string; Graph?: string; Client: Pick<RelayClient, 'CloseCode'> }

// The JSON-RPC server-error codes of the graph catalog. The protocol carries none; the server's home
// is GraphErrorCode in pragmatic-server src/host/graphs/graph-error-codes.ts (reserved -32040..-32045).
export enum GraphErrorCode
{
    NotFound = -32040,
    Exists = -32041,
    NameInvalid = -32042,
    PackageConflict = -32043,
    PackageSegment = -32044,
    PackageMissing = -32045,
}

// The HTTP answers the tenant plane refuses a relay upgrade with.
enum RelayStatus
{
    Unauthorized = 401,
    Forbidden = 403,
    Conflict = 409,
}

// Reads the HTTP status of a refused relay upgrade. ws reports a non-101 answer only as an Error whose
// message is "Unexpected server response: <status>"; the protocol's UpgradeRefusedError carries the
// status (and body) itself. Otherwise the message is parsed here and nowhere else; a numeric
// statusCode/status on the error wins when present.
export class RelayRefusal
{
    private static readonly UnexpectedResponse = /^Unexpected server response: (\d{3})$/

    public static StatusOf(error: unknown): number | undefined
    {
        if (error instanceof UpgradeRefusedError) return error.Status
        if (!(error instanceof Error)) return undefined
        const { statusCode, status } = error as { statusCode?: unknown; status?: unknown }
        if (typeof statusCode === 'number') return statusCode
        if (typeof status === 'number') return status
        const match = RelayRefusal.UnexpectedResponse.exec(error.message)
        return match === null ? undefined : Number(match[1])
    }

    // The body of a refused upgrade (capped by the protocol), or undefined when the error carries none.
    public static BodyOf(error: unknown): string | undefined
    {
        return error instanceof UpgradeRefusedError ? error.Body : undefined
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

    public static IsServerAnswer(error: unknown): error is ResponseError
    {
        return error instanceof ResponseError && !RelayAnswer.ProtocolCodes.includes(error.code)
    }
}

// Opens a JSON-RPC connection to an environment through the desktop relay of the session its target's
// source holds (a tenant's own console, or the platform's tenant plane), which mints and keeps the
// environment credential server-side. Plexus presents only that session's token.
// Every failure becomes a fixed sentence (naming at most the environment and graph): never a URL, a
// token or the underlying transport text. A 401 means that session is over, so it is cleared; a
// console the platform no longer registers answers ConsoleRetired.
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
    private static readonly GraphPrefix = 'The graph '
    private static readonly GraphGoneMiddle = ' no longer exists in '
    private static readonly GraphGoneSuffix = '. Create it again in the tenant console.'
    private static readonly ConflictPrefix = 'A package version is already in '
    private static readonly ConflictSuffix = ' with different content.'
    // The answer for a source with no live session, at connect or on a 401.
    private static readonly SignedOutKinds: Readonly<Record<TargetSource, AccountErrorKind>> = {
        [TargetSource.Console]: AccountErrorKind.SignedOut,
        [TargetSource.Platform]: AccountErrorKind.PlatformSignedOut,
    }

    public constructor(private readonly sessions: IRelaySessionSource, private readonly dial: RelayDial)
    {
    }

    public async Connect(target: TargetRef, kind: TargetKind): Promise<RelayClient>
    {
        const session = await this.LoadSession(target.Source)
        if (session === undefined) throw new AccountError(RelayConnector.SignedOutKinds[target.Source])
        let url: string
        try
        {
            url = RelayConnector.RelayUrl(session.ConsoleUrl, target.Name, kind)
        }
        catch
        {
            throw RelayConnector.Unreachable(target.Name)
        }
        try
        {
            return await this.dial(url, session.Token)
        }
        catch (e)
        {
            // Only installing the certificate fixes this, so it is named rather than called unreachable.
            if (TlsFailure.IsCertificate(e)) throw new AccountError(AccountErrorKind.CertificateUntrusted)
            throw await this.Refusal(e, target, session.Token)
        }
    }

    // An account failure (secure storage gone) keeps its kind; any other failure to read the stored
    // session (a file-system error naming its path) becomes the fixed Unavailable sentence.
    private async LoadSession(source: TargetSource): Promise<SessionAddress | undefined>
    {
        try
        {
            return await this.sessions.SessionFor(source)
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

    private async Refusal(error: unknown, target: TargetRef, token: string): Promise<Error>
    {
        switch (RelayRefusal.StatusOf(error))
        {
            case RelayStatus.Unauthorized:
                await this.ForgetSession(token)
                return new AccountError(RelayConnector.SignedOutKinds[target.Source])
            case RelayStatus.Forbidden:
                return new Error(RelayConnector.NotAllowed)
            case RelayStatus.Conflict:
                return new Error(`${RelayConnector.EnvironmentPrefix}${target.Name}${RelayConnector.NotRunningSuffix}`)
            case ConsoleRetirement.Status:
                return RelayConnector.IsRetiredBody(RelayRefusal.BodyOf(error)) ? new AccountError(AccountErrorKind.ConsoleRetired) : RelayConnector.Unreachable(target.Name)
            default:
                return RelayConnector.Unreachable(target.Name)
        }
    }

    private static IsRetiredBody(body: string | undefined): boolean
    {
        return body !== undefined && ConsoleRetirement.IsBody(body)
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

    // Runs a call on an open relay. A relay that went away mid-call is ConsoleRetired when its socket
    // closed with the retired console's code, else the unreachable sentence. A graph that is gone or a
    // conflicting package version (on a call about a graph) becomes its plain sentence; every other
    // server answer, and an account failure, is rethrown as is; anything else (a JSON-RPC protocol
    // error such as -32601 Method not found, or an error raised on this side) becomes a fixed sentence
    // naming only the environment.
    public static async Call<T>(call: RelayCall, work: () => Promise<T>): Promise<T>
    {
        try
        {
            return await work()
        }
        catch (e)
        {
            throw RelayConnector.CallFailure(call, e)
        }
    }

    private static CallFailure(call: RelayCall, error: unknown): unknown
    {
        if (RelayDrop.Is(error))
        {
            if (call.Client.CloseCode() === ConsoleRetirement.CloseCode) return new AccountError(AccountErrorKind.ConsoleRetired)
            return RelayConnector.Unreachable(call.Environment)
        }
        if (error instanceof AccountError) return error
        if (RelayAnswer.IsServerAnswer(error)) return RelayConnector.GraphSentence(call, error) ?? error
        return new Error(`${RelayConnector.EnvironmentPrefix}${call.Environment}${RelayConnector.NotHandledSuffix}`)
    }

    // The plain sentence for a graph answer the user acts on, or undefined to keep the server's message.
    private static GraphSentence(call: RelayCall, answer: ResponseError): Error | undefined
    {
        if (call.Graph === undefined) return undefined
        switch (answer.code)
        {
            case GraphErrorCode.NotFound:
                return new Error(`${RelayConnector.GraphPrefix}${call.Graph}${RelayConnector.GraphGoneMiddle}${call.Environment}${RelayConnector.GraphGoneSuffix}`)
            case GraphErrorCode.PackageConflict:
                return new Error(`${RelayConnector.ConflictPrefix}${call.Graph}${RelayConnector.ConflictSuffix}`)
            default:
                return undefined
        }
    }

    private static Unreachable(environment: string): Error
    {
        return new Error(`${RelayConnector.EnvironmentPrefix}${environment}${RelayConnector.UnreachableSuffix}`)
    }
}
