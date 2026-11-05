import { AccountError, AccountErrorKind, TargetStatus, UrlBase, type AccountTargets, type EnvironmentTarget } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { TlsFailure } from '../net/system-trust.js'
import type { DesktopSession } from './desktop-session-store.js'
import { TextValue } from './text-value.js'

// A discovered tenant and the console address to sign in at: its own consoleUrl, else the
// platform's tenant plane (FromTenantPlane; that address may carry a base path, so it is checked
// with TenantPlaneAddress rather than ConsoleAddress). Main-process only; the renderer sees only Id
// and DisplayName.
export type DiscoveredConsole = { Id: string; DisplayName: string; ConsoleUrl: string; FromTenantPlane: boolean }
export type Discovery = { Tenants: DiscoveredConsole[]; TenantPlaneUrl: string }
// The tenant a console address serves.
export type ServedTenant = { TenantId: string; TenantName: string }
export type CompletedSignIn = { Token: string; ExpiresAt: string; TenantId: string; TenantName: string; Email?: string }

// The platform's desktop endpoints over plain fetch: discovery on the control plane; the console
// lookup, sign-in, targets and sign-out on a console (a tenant's own console, or the platform's
// tenant plane). Node's fetch sends no Origin header, which those endpoints require. Every failure
// becomes an AccountError of a fixed kind; no server text, URL or token is ever put in an error.
export class DesktopApiClient
{
    private static readonly DiscoverPath = '/api/desktop/discover'
    private static readonly ConsolePath = '/desktop/console'
    private static readonly BeginPath = '/desktop/sign-in/begin'
    private static readonly CompletePath = '/desktop/sign-in/complete'
    private static readonly TargetsPath = '/desktop/targets'
    private static readonly SignOutPath = '/desktop/sign-out'
    private static readonly MethodPost = 'POST'
    private static readonly MethodGet = 'GET'
    private static readonly ContentTypeHeader = 'Content-Type'
    private static readonly AuthorizationHeader = 'Authorization'
    private static readonly AcceptHeader = 'Accept'
    private static readonly JsonType = 'application/json'
    private static readonly BearerPrefix = 'Bearer '
    private static readonly NoRedirects: RequestRedirect = 'error'
    private static readonly ManualRedirects: RequestRedirect = 'manual'
    private static readonly StatusOk = 200
    private static readonly StatusNoContent = 204
    private static readonly StatusBadRequest = 400
    private static readonly StatusUnauthorized = 401
    private static readonly StatusNotFound = 404
    private static readonly StatusTooManyRequests = 429
    private static readonly StatusServerError = 500

    public constructor(private readonly fetch: typeof globalThis.fetch = globalThis.fetch)
    {
    }

    public async Discover(platformUrl: string, email: string): Promise<Discovery>
    {
        const res = await this.Send(platformUrl, DesktopApiClient.DiscoverPath, DesktopApiClient.MethodPost, AccountErrorKind.Unreachable, { email })
        if (res.status === DesktopApiClient.StatusNotFound) throw new AccountError(AccountErrorKind.NoAccount)
        if (res.status === DesktopApiClient.StatusBadRequest) throw new AccountError(AccountErrorKind.InvalidEmail)
        const { tenants, tenantPlaneUrl: plane } = await DesktopApiClient.Body(res)
        if (!Array.isArray(tenants) || typeof plane !== 'string') throw new AccountError(AccountErrorKind.Unavailable)
        const parsed = tenants.map(t => DesktopApiClient.Tenant(t, plane)).filter((t): t is DiscoveredConsole => t !== undefined)
        if (parsed.length === 0) throw new AccountError(AccountErrorKind.NoAccount)
        return { Tenants: parsed, TenantPlaneUrl: plane }
    }

    // Asks an address which tenant's console it is. Anything that does not answer like a console
    // (no such route, a web page, an object without a tenant id, a redirect elsewhere) is
    // NotAConsole. Redirects are not followed but answered (a 3xx, or an opaque redirect of status
    // 0), so a site that redirects reads as reachable but not a console.
    public async Console(consoleUrl: string): Promise<ServedTenant>
    {
        const res = await this.Send(consoleUrl, DesktopApiClient.ConsolePath, DesktopApiClient.MethodGet, AccountErrorKind.ConsoleUnreachable, undefined, undefined, DesktopApiClient.ManualRedirects)
        if (res.status === DesktopApiClient.StatusTooManyRequests || res.status >= DesktopApiClient.StatusServerError) throw new AccountError(AccountErrorKind.Unavailable)
        if (res.status !== DesktopApiClient.StatusOk) throw new AccountError(AccountErrorKind.NotAConsole)
        let parsed: unknown
        try
        {
            parsed = await res.json()
        }
        catch
        {
            throw new AccountError(AccountErrorKind.NotAConsole)
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new AccountError(AccountErrorKind.NotAConsole)
        const { tenantId, tenantName } = parsed as Record<string, unknown>
        if (!TextValue.Filled(tenantId)) throw new AccountError(AccountErrorKind.NotAConsole)
        return { TenantId: tenantId, TenantName: TextValue.Filled(tenantName) ? tenantName : tenantId }
    }

    // Starts a sign-in; answers the IdP authorize URL to open in the system browser.
    public async Begin(consoleUrl: string, tenantId: string, redirectUri: string, challenge: string): Promise<string>
    {
        const res = await this.Send(consoleUrl, DesktopApiClient.BeginPath, DesktopApiClient.MethodPost, AccountErrorKind.ConsoleUnreachable, { tenantId, redirectUri, bindingChallenge: challenge })
        if (res.status === DesktopApiClient.StatusNotFound) throw new AccountError(AccountErrorKind.SignInFailed)
        const { authorizeUrl: url } = await DesktopApiClient.Body(res)
        if (typeof url !== 'string' || url === '') throw new AccountError(AccountErrorKind.Unavailable)
        return url
    }

    public async Complete(consoleUrl: string, state: string, code: string, verifier: string): Promise<CompletedSignIn>
    {
        const res = await this.Send(consoleUrl, DesktopApiClient.CompletePath, DesktopApiClient.MethodPost, AccountErrorKind.ConsoleUnreachable, { state, code, bindingVerifier: verifier })
        if (res.status === DesktopApiClient.StatusUnauthorized) throw new AccountError(AccountErrorKind.SignInFailed)
        const { token, expiresAt, tenantId, tenantName, email } = await DesktopApiClient.Body(res)
        // The same rule the session store applies on Load: a session missing any of these is unusable.
        if (!TextValue.Filled(token) || !TextValue.Filled(expiresAt) || !TextValue.Filled(tenantId) || !TextValue.Filled(tenantName))
        {
            throw new AccountError(AccountErrorKind.SignInFailed)
        }
        return { Token: token, ExpiresAt: expiresAt, TenantId: tenantId, TenantName: tenantName, Email: TextValue.Filled(email) ? email : undefined }
    }

    public async Targets(session: DesktopSession): Promise<AccountTargets>
    {
        const res = await this.Send(session.ConsoleUrl, DesktopApiClient.TargetsPath, DesktopApiClient.MethodGet, AccountErrorKind.ConsoleUnreachable, undefined, session.Token)
        if (res.status === DesktopApiClient.StatusUnauthorized) throw new AccountError(AccountErrorKind.SignedOut)
        const { contribute, publish } = await DesktopApiClient.Body(res)
        return { Contribute: DesktopApiClient.Targets(contribute), Publish: DesktopApiClient.Targets(publish) }
    }

    // Ends the session at its console. A 401 means it was already over, which is the goal.
    public async SignOut(session: DesktopSession): Promise<void>
    {
        const res = await this.Send(session.ConsoleUrl, DesktopApiClient.SignOutPath, DesktopApiClient.MethodPost, AccountErrorKind.ConsoleUnreachable, undefined, session.Token)
        if (res.status === DesktopApiClient.StatusNoContent || res.status === DesktopApiClient.StatusOk || res.status === DesktopApiClient.StatusUnauthorized) return
        throw new AccountError(AccountErrorKind.Unavailable)
    }

    // `unreachable` is the kind raised when the request cannot be made at all; a certificate this
    // computer does not trust is told apart, since only installing that certificate fixes it.
    private async Send(
        base: string, path: string, method: string, unreachable: AccountErrorKind, body: unknown, token?: string,
        redirect: RequestRedirect = DesktopApiClient.NoRedirects,
    ): Promise<Response>
    {
        const headers: Record<string, string> = { [DesktopApiClient.AcceptHeader]: DesktopApiClient.JsonType }
        if (body !== undefined) headers[DesktopApiClient.ContentTypeHeader] = DesktopApiClient.JsonType
        if (token !== undefined) headers[DesktopApiClient.AuthorizationHeader] = `${DesktopApiClient.BearerPrefix}${token}`
        try
        {
            return await this.fetch(`${UrlBase.Of(base)}${path}`, {
                method,
                headers,
                body: body === undefined ? undefined : JSON.stringify(body),
                redirect,
            })
        }
        catch (e)
        {
            throw new AccountError(TlsFailure.IsCertificate(e) ? AccountErrorKind.CertificateUntrusted : unreachable)
        }
    }

    // A 2xx JSON object, or Unavailable (throttled, server error, not JSON).
    private static async Body(res: Response): Promise<Record<string, unknown>>
    {
        if (res.status !== DesktopApiClient.StatusOk) throw new AccountError(AccountErrorKind.Unavailable)
        let parsed: unknown
        try
        {
            parsed = await res.json()
        }
        catch
        {
            throw new AccountError(AccountErrorKind.Unavailable)
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new AccountError(AccountErrorKind.Unavailable)
        return parsed as Record<string, unknown>
    }

    // A tenant without a usable consoleUrl of its own signs in at the platform's tenant plane. Any
    // other string is kept as given; the caller validates it before dialling.
    private static Tenant(raw: unknown, tenantPlaneUrl: string): DiscoveredConsole | undefined
    {
        if (typeof raw !== 'object' || raw === null) return undefined
        const { id, displayName, consoleUrl } = raw as Record<string, unknown>
        if (!TextValue.Filled(id)) return undefined
        const own = TextValue.Filled(consoleUrl)
        return {
            Id: id,
            DisplayName: TextValue.Filled(displayName) ? displayName : id,
            ConsoleUrl: own ? consoleUrl : tenantPlaneUrl,
            FromTenantPlane: !own,
        }
    }

    private static Targets(raw: unknown): EnvironmentTarget[]
    {
        if (!Array.isArray(raw)) return []
        const targets: EnvironmentTarget[] = []
        for (const entry of raw)
        {
            if (typeof entry !== 'object' || entry === null) continue
            const { name, status } = entry as Record<string, unknown>
            if (typeof name !== 'string' || name === '') continue
            targets.push({ Name: name, Status: DesktopApiClient.Status(status) })
        }
        return targets
    }

    private static Status(raw: unknown): TargetStatus
    {
        return Object.values(TargetStatus).includes(raw as TargetStatus) ? raw as TargetStatus : TargetStatus.Unknown
    }
}
