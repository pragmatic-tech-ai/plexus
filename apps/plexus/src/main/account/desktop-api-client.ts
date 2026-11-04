import { AccountError, AccountErrorKind, TargetStatus, type AccountTargets, type DiscoveredTenant, type EnvironmentTarget } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { DesktopSession } from './desktop-session-store.js'

export type Discovery = { Tenants: DiscoveredTenant[]; TenantPlaneUrl: string }
export type CompletedSignIn = { Token: string; ExpiresAt: string; TenantId: string; TenantName: string; Email?: string }

// The platform's desktop endpoints over plain fetch: discovery on the control plane, sign-in, targets
// and sign-out on the tenant plane. Node's fetch sends no Origin header, which those endpoints
// require. Every failure becomes an AccountError of a fixed kind; no server text, URL or token is
// ever put in an error.
export class DesktopApiClient
{
    private static readonly DiscoverPath = '/api/desktop/discover'
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
    private static readonly TrailingSlashes = /\/+$/
    private static readonly NoRedirects: RequestRedirect = 'error'
    private static readonly StatusOk = 200
    private static readonly StatusNoContent = 204
    private static readonly StatusBadRequest = 400
    private static readonly StatusUnauthorized = 401
    private static readonly StatusNotFound = 404

    public constructor(private readonly fetch: typeof globalThis.fetch = globalThis.fetch)
    {
    }

    public async Discover(platformUrl: string, email: string): Promise<Discovery>
    {
        const res = await this.Send(platformUrl, DesktopApiClient.DiscoverPath, DesktopApiClient.MethodPost, { email })
        if (res.status === DesktopApiClient.StatusNotFound) throw new AccountError(AccountErrorKind.NoAccount)
        if (res.status === DesktopApiClient.StatusBadRequest) throw new AccountError(AccountErrorKind.InvalidEmail)
        const { tenants, tenantPlaneUrl: plane } = await DesktopApiClient.Body(res)
        if (!Array.isArray(tenants) || typeof plane !== 'string') throw new AccountError(AccountErrorKind.Unavailable)
        const parsed = tenants.map(t => DesktopApiClient.Tenant(t)).filter((t): t is DiscoveredTenant => t !== undefined)
        if (parsed.length === 0) throw new AccountError(AccountErrorKind.NoAccount)
        return { Tenants: parsed, TenantPlaneUrl: plane }
    }

    // Starts a sign-in; answers the IdP authorize URL to open in the system browser.
    public async Begin(tenantPlaneUrl: string, tenantId: string, redirectUri: string, challenge: string): Promise<string>
    {
        const res = await this.Send(tenantPlaneUrl, DesktopApiClient.BeginPath, DesktopApiClient.MethodPost, { tenantId, redirectUri, bindingChallenge: challenge })
        if (res.status === DesktopApiClient.StatusNotFound) throw new AccountError(AccountErrorKind.SignInFailed)
        const { authorizeUrl: url } = await DesktopApiClient.Body(res)
        if (typeof url !== 'string' || url === '') throw new AccountError(AccountErrorKind.Unavailable)
        return url
    }

    public async Complete(tenantPlaneUrl: string, state: string, code: string, verifier: string): Promise<CompletedSignIn>
    {
        const res = await this.Send(tenantPlaneUrl, DesktopApiClient.CompletePath, DesktopApiClient.MethodPost, { state, code, bindingVerifier: verifier })
        if (res.status === DesktopApiClient.StatusUnauthorized) throw new AccountError(AccountErrorKind.SignInFailed)
        const { token, expiresAt, tenantId, tenantName, email } = await DesktopApiClient.Body(res)
        // The same rule the session store applies on Load: a session missing any of these is unusable.
        if (!DesktopApiClient.Filled(token) || !DesktopApiClient.Filled(expiresAt) || !DesktopApiClient.Filled(tenantId) || !DesktopApiClient.Filled(tenantName))
        {
            throw new AccountError(AccountErrorKind.SignInFailed)
        }
        return { Token: token, ExpiresAt: expiresAt, TenantId: tenantId, TenantName: tenantName, Email: DesktopApiClient.Filled(email) ? email : undefined }
    }

    public async Targets(session: DesktopSession): Promise<AccountTargets>
    {
        const res = await this.Send(session.TenantPlaneUrl, DesktopApiClient.TargetsPath, DesktopApiClient.MethodGet, undefined, session.Token)
        if (res.status === DesktopApiClient.StatusUnauthorized) throw new AccountError(AccountErrorKind.SignedOut)
        const { contribute, publish } = await DesktopApiClient.Body(res)
        return { Contribute: DesktopApiClient.Targets(contribute), Publish: DesktopApiClient.Targets(publish) }
    }

    // Ends the session on the tenant plane. A 401 means it was already over, which is the goal.
    public async SignOut(session: DesktopSession): Promise<void>
    {
        const res = await this.Send(session.TenantPlaneUrl, DesktopApiClient.SignOutPath, DesktopApiClient.MethodPost, undefined, session.Token)
        if (res.status === DesktopApiClient.StatusNoContent || res.status === DesktopApiClient.StatusOk || res.status === DesktopApiClient.StatusUnauthorized) return
        throw new AccountError(AccountErrorKind.Unavailable)
    }

    private async Send(base: string, path: string, method: string, body: unknown, token?: string): Promise<Response>
    {
        const headers: Record<string, string> = { [DesktopApiClient.AcceptHeader]: DesktopApiClient.JsonType }
        if (body !== undefined) headers[DesktopApiClient.ContentTypeHeader] = DesktopApiClient.JsonType
        if (token !== undefined) headers[DesktopApiClient.AuthorizationHeader] = `${DesktopApiClient.BearerPrefix}${token}`
        try
        {
            return await this.fetch(`${base.trim().replace(DesktopApiClient.TrailingSlashes, '')}${path}`, {
                method,
                headers,
                body: body === undefined ? undefined : JSON.stringify(body),
                redirect: DesktopApiClient.NoRedirects,
            })
        }
        catch
        {
            throw new AccountError(AccountErrorKind.Unreachable)
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

    private static Filled(value: unknown): value is string
    {
        return typeof value === 'string' && value !== ''
    }

    private static Tenant(raw: unknown): DiscoveredTenant | undefined
    {
        if (typeof raw !== 'object' || raw === null) return undefined
        const { id, displayName } = raw as Record<string, unknown>
        if (typeof id !== 'string' || id === '') return undefined
        return { Id: id, DisplayName: typeof displayName === 'string' && displayName !== '' ? displayName : id }
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
