import { createHash } from 'node:crypto'

type Recorded = { Url: string; Method: string; Headers: Record<string, string>; Form: URLSearchParams | undefined; Json: Record<string, unknown> | undefined }
type Route = (request: Recorded) => Response | Promise<Response>

// A fetch double keyed by origin + path (or path alone). A missing route answers a network failure,
// like an unreachable host. Form bodies are parsed as URLSearchParams, JSON bodies as objects.
export class FakeFetch
{
    public readonly Requests: Recorded[] = []
    public readonly Routes = new Map<string, Route>()

    public readonly Fetch = async (input: string | URL, init?: RequestInit): Promise<Response> =>
    {
        const url = String(input)
        const headers = Object.fromEntries(new Headers(init?.headers).entries())
        const raw = typeof init?.body === 'string' ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : undefined
        const isForm = (headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded') || init?.body instanceof URLSearchParams
        const request: Recorded = {
            Url: url,
            Method: init?.method ?? 'GET',
            Headers: headers,
            Form: raw !== undefined && isForm ? new URLSearchParams(raw) : undefined,
            Json: raw !== undefined && !isForm ? JSON.parse(raw) as Record<string, unknown> : undefined,
        }
        this.Requests.push(request)
        const parsed = new URL(url)
        const route = this.Routes.get(`${parsed.origin}${parsed.pathname}`) ?? this.Routes.get(parsed.pathname)
        if (route === undefined) throw new TypeError('fetch failed')
        const signal = init?.signal
        if (signal === undefined || signal === null) return await route(request)
        // Honours the caller's abort (a time-out), like Node's fetch.
        return await new Promise<Response>((resolve, reject) =>
        {
            if (signal.aborted) return reject(signal.reason)
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
            Promise.resolve(route(request)).then(resolve, reject)
        })
    }

    public static Json(status: number, body: unknown): Response
    {
        return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    }

    public At(url: string): Recorded[]
    {
        return this.Requests.filter(r => r.Url.split('?')[0] === url)
    }
}

// The realm side of the desktop sign-in, as the server dependencies S1-S3 describe it: discovery,
// the token endpoint (authorization code with PKCE for the public client `plexus`, rotating refresh
// tokens with reuse detection) and revocation. ID tokens are JWT-shaped with a dummy signature (Plexus
// checks claims, not signatures: ruling E5). Codes are minted by `Authorize`, as the browser leg would.
export class FakeRealm
{
    public static readonly Issuer = 'https://hive.acme.example/realms/acme'
    public static readonly ClientId = 'plexus'
    public readonly Token: string
    public readonly Revoke: string
    public readonly AuthorizeEndpoint: string
    public Subject = 'acct-1'
    public Email = 'ada@acme.example'
    public ExpiresIn = 600
    public NowSeconds = (): number => Math.floor(Date.now() / 1000)
    public Refreshes = 0
    public readonly Revoked: string[] = []
    // Live refresh tokens; a used one moves to `used`, and presenting it again revokes the family.
    private readonly live = new Set<string>()
    private readonly used = new Set<string>()
    private readonly codes = new Map<string, { Challenge: string; RedirectUri: string; Nonce: string }>()
    private serial = 0
    // When set, the token endpoint answers this instead (a scripted refusal or outage).
    public TokenOverride: (() => Response) | undefined

    public constructor(public readonly Fetch: FakeFetch, public readonly Issuer: string = FakeRealm.Issuer)
    {
        this.Token = `${Issuer}/protocol/openid-connect/token`
        this.Revoke = `${Issuer}/protocol/openid-connect/revoke`
        this.AuthorizeEndpoint = `${Issuer}/protocol/openid-connect/auth`
        Fetch.Routes.set(`${Issuer}/.well-known/openid-configuration`, () => FakeFetch.Json(200, this.Discovery()))
        Fetch.Routes.set(this.Token, r => this.TokenAnswer(r.Form!))
        Fetch.Routes.set(this.Revoke, r => this.RevokeAnswer(r.Form!))
    }

    public Discovery(): Record<string, unknown>
    {
        return {
            issuer: this.Issuer,
            authorization_endpoint: this.AuthorizeEndpoint,
            token_endpoint: this.Token,
            revocation_endpoint: this.Revoke,
            code_challenge_methods_supported: ['S256'],
            token_endpoint_auth_methods_supported: ['none', 'client_secret_basic'],
        }
    }

    // The browser leg: reads the authorize URL Plexus built and mints the code the realm would redirect with.
    public Authorize(authorizeUrl: string): { Code: string; State: string; RedirectUri: string }
    {
        const url = new URL(authorizeUrl)
        const p = url.searchParams
        const code = `code-${++this.serial}`
        this.codes.set(code, { Challenge: p.get('code_challenge') ?? '', RedirectUri: p.get('redirect_uri') ?? '', Nonce: p.get('nonce') ?? '' })
        return { Code: code, State: p.get('state') ?? '', RedirectUri: p.get('redirect_uri') ?? '' }
    }

    public IsLive(refreshToken: string): boolean
    {
        return this.live.has(refreshToken)
    }

    public static IdToken(claims: Record<string, unknown>): string
    {
        const part = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
        return `${part({ alg: 'RS256', typ: 'JWT' })}.${part(claims)}.c2lnbmF0dXJl`
    }

    private TokenAnswer(form: URLSearchParams): Response
    {
        if (this.TokenOverride !== undefined) return this.TokenOverride()
        if (form.get('client_id') !== FakeRealm.ClientId || form.has('client_secret')) return FakeFetch.Json(401, { error: 'invalid_client' })
        if (form.get('grant_type') === 'authorization_code') return this.Exchange(form)
        if (form.get('grant_type') === 'refresh_token') return this.Refresh(form)
        return FakeFetch.Json(400, { error: 'unsupported_grant_type' })
    }

    private Exchange(form: URLSearchParams): Response
    {
        const code = this.codes.get(form.get('code') ?? '')
        this.codes.delete(form.get('code') ?? '')
        const verifier = form.get('code_verifier') ?? ''
        const challenge = createHash('sha256').update(verifier).digest('base64url')
        if (code === undefined || code.Challenge !== challenge || code.RedirectUri !== form.get('redirect_uri')) return FakeFetch.Json(400, { error: 'invalid_grant' })
        const now = this.NowSeconds()
        const idToken = FakeRealm.IdToken({ iss: this.Issuer, aud: FakeRealm.ClientId, azp: FakeRealm.ClientId, sub: this.Subject, email: this.Email, iat: now, exp: now + 300, nonce: code.Nonce })
        return FakeFetch.Json(200, { access_token: this.NextAccess(), token_type: 'Bearer', expires_in: this.ExpiresIn, refresh_token: this.NextRefresh(), id_token: idToken })
    }

    private Refresh(form: URLSearchParams): Response
    {
        const presented = form.get('refresh_token') ?? ''
        if (this.used.has(presented))
        {
            // Reuse: the whole family is revoked, as the realm sign-in service does.
            this.live.clear()
            return FakeFetch.Json(400, { error: 'invalid_grant' })
        }
        if (!this.live.has(presented)) return FakeFetch.Json(400, { error: 'invalid_grant' })
        this.live.delete(presented)
        this.used.add(presented)
        this.Refreshes++
        return FakeFetch.Json(200, { access_token: this.NextAccess(), token_type: 'bearer', expires_in: this.ExpiresIn, refresh_token: this.NextRefresh() })
    }

    private RevokeAnswer(form: URLSearchParams): Response
    {
        const token = form.get('token') ?? ''
        this.Revoked.push(token)
        this.live.delete(token)
        return new Response(null, { status: 200 })
    }

    private NextAccess(): string
    {
        return `access-${++this.serial}`
    }

    private NextRefresh(): string
    {
        const token = `refresh-${++this.serial}`
        this.live.add(token)
        return token
    }
}
