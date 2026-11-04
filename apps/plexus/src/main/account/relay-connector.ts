import type { PragmaticClient } from '@pragmatic-tech-ai/pragmatic-protocol'
import { AccountError, AccountErrorKind, type TargetKind } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { DesktopSession } from './desktop-session-store.js'

// The methods the contribute and publish flows call on a relay connection (PragmaticClient has them).
export type RelayClient = Pick<PragmaticClient, 'ListGraphs' | 'ContributeGraph' | 'DeployApplication' | 'DisposeAsync'>

// Opens the connection: production is PragmaticClient.ConnectAsync(url, { bearerToken: token }).
export type RelayDial = (url: string, token: string) => Promise<RelayClient>

// The slice of AccountService the connector needs (AccountService satisfies it).
export interface IRelaySessionSource
{
    Session(): Promise<DesktopSession | undefined>;
    HandleSignedOut(): Promise<void>;
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

// Opens a JSON-RPC connection to an environment through the tenant plane's desktop relay, which mints
// and keeps the environment credential server-side. Plexus presents only the desktop session token.
// Every failure becomes a fixed sentence (naming at most the environment): never a URL, a token or
// the underlying transport text. A 401 means the session is over, so the account is cleared.
export class RelayConnector implements IRelayConnector
{
    private static readonly RelayPath = '/desktop/relay'
    private static readonly EnvironmentParam = 'environment'
    private static readonly ActionParam = 'action'
    private static readonly SocketSchemes: Readonly<Record<string, string>> = { 'http:': 'ws:', 'https:': 'wss:' }
    private static readonly BadPlane = 'The tenant plane address is not usable.'
    private static readonly NotAllowed = "Your account can't use this environment."
    private static readonly EnvironmentPrefix = 'The environment '
    private static readonly NotRunningSuffix = ' is not running. Start it from the tenant console.'
    private static readonly UnreachableSuffix = ' could not be reached.'

    public constructor(private readonly sessions: IRelaySessionSource, private readonly dial: RelayDial)
    {
    }

    public async Connect(environment: string, kind: TargetKind): Promise<RelayClient>
    {
        const session = await this.sessions.Session()
        if (session === undefined) throw new AccountError(AccountErrorKind.SignedOut)
        let url: string
        try
        {
            url = RelayConnector.RelayUrl(session.TenantPlaneUrl, environment, kind)
        }
        catch
        {
            throw new Error(RelayConnector.Unreachable(environment))
        }
        try
        {
            return await this.dial(url, session.Token)
        }
        catch (e)
        {
            throw await this.Refusal(RelayRefusal.StatusOf(e), environment)
        }
    }

    // ws(s)://<tenant plane>/desktop/relay?environment=<name>&action=<kind>. Encoded by hand so a
    // space is %20 (URLSearchParams would write +).
    public static RelayUrl(tenantPlaneUrl: string, environment: string, kind: TargetKind): string
    {
        const plane = new URL(tenantPlaneUrl)
        const scheme = RelayConnector.SocketSchemes[plane.protocol]
        if (scheme === undefined) throw new Error(RelayConnector.BadPlane)
        const base = plane.pathname.replace(/\/+$/, '')
        const query = `${RelayConnector.EnvironmentParam}=${encodeURIComponent(environment)}&${RelayConnector.ActionParam}=${encodeURIComponent(kind)}`
        return `${scheme}//${plane.host}${base}${RelayConnector.RelayPath}?${query}`
    }

    private async Refusal(status: number | undefined, environment: string): Promise<Error>
    {
        switch (status)
        {
            case RelayStatus.Unauthorized:
                await this.ForgetSession()
                return new AccountError(AccountErrorKind.SignedOut)
            case RelayStatus.Forbidden:
                return new Error(RelayConnector.NotAllowed)
            case RelayStatus.Conflict:
                return new Error(`${RelayConnector.EnvironmentPrefix}${environment}${RelayConnector.NotRunningSuffix}`)
            default:
                return new Error(RelayConnector.Unreachable(environment))
        }
    }

    // A failure to clear the local copy must not replace the SignedOut answer the user acts on.
    private async ForgetSession(): Promise<void>
    {
        try
        {
            await this.sessions.HandleSignedOut()
        }
        catch
        {
            // the next relay or targets call meets the same 401 and tries again
        }
    }

    private static Unreachable(environment: string): string
    {
        return `${RelayConnector.EnvironmentPrefix}${environment}${RelayConnector.UnreachableSuffix}`
    }
}
