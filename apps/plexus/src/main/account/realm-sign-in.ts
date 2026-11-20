import { createHash, randomBytes } from 'node:crypto'
import { AccountError, AccountErrorKind, TransportRule, UrlBase } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { TlsFailure } from '../net/system-trust.js'
import type { RealmGrant } from './desktop-session-store.js'
import { TextValue } from './text-value.js'

// Plexus as a native public OIDC client of a tenant's realm (RFC 8252; spec
// dev-kit/docs/superpowers/specs/2026-11-20-e-plexus-new-stack-design.md, server dependencies S1-S3).
// Every failure is an AccountError of a fixed kind (ruling E8): never a server text, URL or token.

// Shared plumbing of the realm requests: the one fetch call, its failure kinds, and the JSON reader.
class RealmHttp
{
    public static readonly NoRedirects: RequestRedirect = 'error'
    public static readonly FormType = 'application/x-www-form-urlencoded'
    public static readonly JsonType = 'application/json'
    public static readonly ContentTypeHeader = 'Content-Type'
    public static readonly AcceptHeader = 'Accept'
    public static readonly MethodGet = 'GET'
    public static readonly MethodPost = 'POST'
    // A realm that accepts the connection and never answers must not hold a sign-in or a refresh
    // (and the session writes queued behind it) for undici's minutes.
    public static readonly DefaultTimeoutMs = 30_000

    // A request to the realm; network failure or time-out is ConsoleUnreachable (the realm lives in
    // the hive the console is in), an untrusted certificate CertificateUntrusted.
    public static async Send(fetch: typeof globalThis.fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Response>
    {
        try
        {
            return await fetch(url, { ...init, redirect: RealmHttp.NoRedirects, signal: AbortSignal.timeout(timeoutMs) })
        }
        catch (e)
        {
            throw new AccountError(TlsFailure.IsCertificate(e) ? AccountErrorKind.CertificateUntrusted : AccountErrorKind.ConsoleUnreachable)
        }
    }

    public static Post(fetch: typeof globalThis.fetch, url: string, form: URLSearchParams, timeoutMs: number): Promise<Response>
    {
        return RealmHttp.Send(fetch, url, {
            method: RealmHttp.MethodPost,
            headers: { [RealmHttp.ContentTypeHeader]: RealmHttp.FormType, [RealmHttp.AcceptHeader]: RealmHttp.JsonType },
            body: form.toString(),
        }, timeoutMs)
    }

    // The JSON object of an answer, or undefined when it is not one.
    public static async Object(res: Response): Promise<Record<string, unknown> | undefined>
    {
        let parsed: unknown
        try
        {
            parsed = await res.json()
        }
        catch
        {
            return undefined
        }
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
    }
}

// A realm address Plexus will dial: the one home of that rule, for the provider document and for a
// stored grant read back from disk.
export class RealmEndpoint
{
    // A URL that follows the transport rule (https, cleartext only on loopback).
    public static IsUsable(value: unknown): value is string
    {
        if (!TextValue.Filled(value)) return false
        try
        {
            return TransportRule.IsSecureOrLoopback(new URL(value))
        }
        catch
        {
            return false
        }
    }
}

// A realm's endpoints, read from its OIDC discovery document and checked: the document names exactly
// the issuer asked for, an authorization and a token endpoint, and S256 whenever it lists challenge
// methods; every address follows the transport rule.
export class RealmProvider
{
    private static readonly DiscoveryPath = '/.well-known/openid-configuration'
    private static readonly S256 = 'S256'
    private static readonly IssuerField = 'issuer'
    private static readonly AuthorizationField = 'authorization_endpoint'
    private static readonly TokenField = 'token_endpoint'
    private static readonly RevocationField = 'revocation_endpoint'
    private static readonly ChallengeMethodsField = 'code_challenge_methods_supported'
    private static readonly StatusOk = 200

    private constructor(
        public readonly Issuer: string,
        public readonly AuthorizationEndpoint: string,
        public readonly TokenEndpoint: string,
        public readonly RevocationEndpoint: string | undefined,
    )
    {
    }

    // The issuer must be named exactly as the console named it (OIDC Discovery 4.3); trailing slashes
    // are dropped only to build the document's path.
    public static async Discover(issuer: string, fetch: typeof globalThis.fetch = globalThis.fetch, timeoutMs: number = RealmHttp.DefaultTimeoutMs): Promise<RealmProvider>
    {
        const P = RealmProvider
        const expected = issuer.trim()
        if (!RealmEndpoint.IsUsable(expected)) throw new AccountError(AccountErrorKind.Unavailable)
        const res = await RealmHttp.Send(fetch, `${UrlBase.Of(expected)}${P.DiscoveryPath}`, { method: RealmHttp.MethodGet, headers: { [RealmHttp.AcceptHeader]: RealmHttp.JsonType } }, timeoutMs)
        const doc = res.status === P.StatusOk ? await RealmHttp.Object(res) : undefined
        if (doc === undefined || doc[P.IssuerField] !== expected) throw new AccountError(AccountErrorKind.Unavailable)
        const authorization = doc[P.AuthorizationField]
        const token = doc[P.TokenField]
        const revocation = doc[P.RevocationField]
        if (!RealmEndpoint.IsUsable(authorization) || !RealmEndpoint.IsUsable(token)) throw new AccountError(AccountErrorKind.Unavailable)
        if (revocation !== undefined && !RealmEndpoint.IsUsable(revocation)) throw new AccountError(AccountErrorKind.Unavailable)
        const methods = doc[P.ChallengeMethodsField]
        if (methods !== undefined && (!Array.isArray(methods) || !methods.includes(P.S256))) throw new AccountError(AccountErrorKind.Unavailable)
        return new RealmProvider(expected, authorization, token, revocation)
    }
}

// One authorization code request (PKCE S256, state, nonce): its secrets and the authorize URL that
// carries their public halves. Single use: a new sign-in creates a new one.
export class RealmAuthorization
{
    public static readonly Scope = 'openid email profile offline_access'
    private static readonly VerifierBytes = 32
    private static readonly StateBytes = 16
    private static readonly Base64Url = 'base64url'
    private static readonly Sha256 = 'sha256'
    private static readonly CodeResponse = 'code'
    private static readonly S256 = 'S256'
    private static readonly ResponseTypeParam = 'response_type'
    private static readonly ClientIdParam = 'client_id'
    private static readonly RedirectUriParam = 'redirect_uri'
    private static readonly ScopeParam = 'scope'
    private static readonly StateParam = 'state'
    private static readonly NonceParam = 'nonce'
    private static readonly ChallengeParam = 'code_challenge'
    private static readonly ChallengeMethodParam = 'code_challenge_method'

    private constructor(
        public readonly Provider: RealmProvider,
        public readonly ClientId: string,
        public readonly RedirectUri: string,
        public readonly Verifier: string,
        public readonly State: string,
        public readonly Nonce: string,
    )
    {
    }

    public static Create(provider: RealmProvider, clientId: string, redirectUri: string): RealmAuthorization
    {
        const A = RealmAuthorization
        return new RealmAuthorization(
            provider, clientId, redirectUri,
            randomBytes(A.VerifierBytes).toString(A.Base64Url),
            randomBytes(A.StateBytes).toString(A.Base64Url),
            randomBytes(A.StateBytes).toString(A.Base64Url),
        )
    }

    public Url(): string
    {
        const A = RealmAuthorization
        const url = new URL(this.Provider.AuthorizationEndpoint)
        const p = url.searchParams
        p.set(A.ResponseTypeParam, A.CodeResponse)
        p.set(A.ClientIdParam, this.ClientId)
        p.set(A.RedirectUriParam, this.RedirectUri)
        p.set(A.ScopeParam, A.Scope)
        p.set(A.StateParam, this.State)
        p.set(A.NonceParam, this.Nonce)
        p.set(A.ChallengeParam, createHash(A.Sha256).update(this.Verifier).digest(A.Base64Url))
        p.set(A.ChallengeMethodParam, A.S256)
        return url.toString()
    }
}

// What the token endpoint answered: the access token (the desktop bearer), when it expires, and the
// rotated refresh token and the ID token when they came.
export type RealmTokens = { AccessToken: string; ExpiresAt: string; LifetimeMs: number; RefreshToken?: string; IdToken?: string }
export type RealmSignInTokens = RealmTokens & { RefreshToken: string; IdToken: string }

// The realm refused a refresh token (spent, revoked, the account gone): the session is over.
export class RealmGrantRefused extends Error
{
    private static readonly Text = 'The realm refused the sign-in grant.'
    private static readonly ErrorName = 'RealmGrantRefused'

    public constructor()
    {
        super(RealmGrantRefused.Text)
        this.name = RealmGrantRefused.ErrorName
    }
}

// The realm's discovery, token and revocation endpoints for the public client: no secret, `client_id` in the body.
export class RealmTokenClient
{
    private static readonly GrantTypeField = 'grant_type'
    private static readonly AuthorizationCodeGrant = 'authorization_code'
    private static readonly RefreshTokenGrant = 'refresh_token'
    private static readonly CodeField = 'code'
    private static readonly RedirectUriField = 'redirect_uri'
    private static readonly ClientIdField = 'client_id'
    private static readonly VerifierField = 'code_verifier'
    private static readonly RefreshTokenField = 'refresh_token'
    private static readonly TokenField = 'token'
    private static readonly TokenTypeHintField = 'token_type_hint'
    private static readonly RefreshTokenHint = 'refresh_token'
    private static readonly AccessTokenField = 'access_token'
    private static readonly TokenTypeField = 'token_type'
    private static readonly ExpiresInField = 'expires_in'
    private static readonly IdTokenField = 'id_token'
    private static readonly ErrorField = 'error'
    private static readonly BearerType = 'bearer'
    private static readonly RefusedErrors: readonly string[] = ['invalid_grant', 'invalid_client', 'unauthorized_client']
    private static readonly RefusedStatuses: readonly number[] = [400, 401]
    private static readonly StatusOk = 200
    private static readonly MsPerSecond = 1000

    public constructor(
        private readonly fetch: typeof globalThis.fetch = globalThis.fetch,
        private readonly now: () => number = Date.now,
        private readonly timeoutMs: number = RealmHttp.DefaultTimeoutMs,
    )
    {
    }

    // The realm's endpoints, read over this client's fetch.
    public Discover(issuer: string): Promise<RealmProvider>
    {
        return RealmProvider.Discover(issuer, this.fetch, this.timeoutMs)
    }

    // The code from the loopback for tokens. A refusal is SignInFailed; the answer must carry an ID
    // token and a refresh token (the native client signs in for a lasting session).
    public async ExchangeCode(request: RealmAuthorization, code: string): Promise<RealmSignInTokens>
    {
        const T = RealmTokenClient
        const form = new URLSearchParams({
            [T.GrantTypeField]: T.AuthorizationCodeGrant,
            [T.CodeField]: code,
            [T.RedirectUriField]: request.RedirectUri,
            [T.ClientIdField]: request.ClientId,
            [T.VerifierField]: request.Verifier,
        })
        const res = await RealmHttp.Post(this.fetch, request.Provider.TokenEndpoint, form, this.timeoutMs)
        if (await T.IsRefusal(res)) throw new AccountError(AccountErrorKind.SignInFailed)
        const body = await T.Body(res)
        try
        {
            const tokens = this.Tokens(body)
            if (tokens.RefreshToken === undefined || tokens.IdToken === undefined) throw new AccountError(AccountErrorKind.Unavailable)
            return { ...tokens, RefreshToken: tokens.RefreshToken, IdToken: tokens.IdToken }
        }
        catch (e)
        {
            // An answer that cannot be used may still have issued a refresh token: it is ended, not left live.
            await this.RevokeStray(request, body)
            throw e
        }
    }

    // A fresh access token for the grant; RealmGrantRefused when the realm will not renew it.
    public async Refresh(grant: RealmGrant): Promise<RealmTokens>
    {
        const T = RealmTokenClient
        const form = new URLSearchParams({ [T.GrantTypeField]: T.RefreshTokenGrant, [T.RefreshTokenField]: grant.RefreshToken, [T.ClientIdField]: grant.ClientId })
        const res = await RealmHttp.Post(this.fetch, grant.TokenEndpoint, form, this.timeoutMs)
        if (await T.IsRefusal(res)) throw new RealmGrantRefused()
        return this.Tokens(await T.Body(res))
    }

    // RFC 7009: ends the grant's refresh token (and its family) at the realm. Any answer is taken (a
    // revocation endpoint answers 200 even for an unknown token); without an endpoint there is nothing
    // to end it at.
    public async Revoke(grant: Pick<RealmGrant, 'ClientId' | 'RefreshToken' | 'RevocationEndpoint'>): Promise<void>
    {
        const T = RealmTokenClient
        if (grant.RevocationEndpoint === undefined) return
        const form = new URLSearchParams({ [T.TokenField]: grant.RefreshToken, [T.TokenTypeHintField]: T.RefreshTokenHint, [T.ClientIdField]: grant.ClientId })
        await RealmHttp.Post(this.fetch, grant.RevocationEndpoint, form, this.timeoutMs)
    }

    private async RevokeStray(request: RealmAuthorization, body: Record<string, unknown> | undefined): Promise<void>
    {
        const refresh = body?.[RealmTokenClient.RefreshTokenField]
        const endpoint = request.Provider.RevocationEndpoint
        if (!TextValue.Filled(refresh) || endpoint === undefined) return
        try
        {
            await this.Revoke({ ClientId: request.ClientId, RefreshToken: refresh, RevocationEndpoint: endpoint })
        }
        catch
        {
            // unreachable: the stray token lives until the realm expires it; nothing here holds it
        }
    }

    // A 200 answer's JSON object, or undefined.
    private static async Body(res: Response): Promise<Record<string, unknown> | undefined>
    {
        return res.status === RealmTokenClient.StatusOk ? RealmHttp.Object(res) : undefined
    }

    private static async IsRefusal(res: Response): Promise<boolean>
    {
        if (!RealmTokenClient.RefusedStatuses.includes(res.status)) return false
        const body = await RealmHttp.Object(res.clone())
        const error = body?.[RealmTokenClient.ErrorField]
        return typeof error === 'string' && RealmTokenClient.RefusedErrors.includes(error)
    }

    private Tokens(body: Record<string, unknown> | undefined): RealmTokens
    {
        const T = RealmTokenClient
        if (body === undefined) throw new AccountError(AccountErrorKind.Unavailable)
        const access = body[T.AccessTokenField]
        const type = body[T.TokenTypeField]
        const expiresIn = body[T.ExpiresInField]
        const refresh = body[T.RefreshTokenField]
        const id = body[T.IdTokenField]
        const bearer = typeof type === 'string' && type.toLowerCase() === T.BearerType
        const expiry = typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0
        if (!TextValue.Filled(access) || !bearer || !expiry) throw new AccountError(AccountErrorKind.Unavailable)
        if ((refresh !== undefined && !TextValue.Filled(refresh)) || (id !== undefined && !TextValue.Filled(id))) throw new AccountError(AccountErrorKind.Unavailable)
        return {
            AccessToken: access,
            ExpiresAt: new Date(this.now() + expiresIn * T.MsPerSecond).toISOString(),
            LifetimeMs: expiresIn * T.MsPerSecond,
            RefreshToken: refresh,
            IdToken: id,
        }
    }
}

// Who signed in, from a checked ID token.
export type RealmIdentity = { Subject: string; Email?: string }

// The claims checks of an ID token received straight from the token endpoint over TLS (OIDC Core
// 3.1.3.7: issuer, audience, `azp` required with several audiences, expiry, issue time, nonce). The signature
// is not checked (OIDC Core 3.1.3.7 (6), ruling E5): Plexus never forwards the ID token, and the
// console verifies the access token's signature itself. Any failure is SignInFailed.
export class RealmIdToken
{
    private static readonly SkewSeconds = 60
    private static readonly MsPerSecond = 1000
    private static readonly PartCount = 3
    private static readonly Separator = '.'
    private static readonly Base64Url = 'base64url'
    private static readonly Utf8 = 'utf8'

    public static Check(idToken: string, issuer: string, clientId: string, nonce: string, nowMs: number): RealmIdentity
    {
        const claims = RealmIdToken.Payload(idToken)
        const now = nowMs / RealmIdToken.MsPerSecond
        const skew = RealmIdToken.SkewSeconds
        const { iss, aud, azp, exp, iat, sub, email } = claims
        const audiences = Array.isArray(aud) ? aud : [aud]
        const valid = iss === issuer
            && audiences.includes(clientId)
            && (azp === undefined ? audiences.length === 1 : azp === clientId)
            && typeof exp === 'number' && exp + skew > now
            && typeof iat === 'number' && iat - skew <= now
            && claims.nonce === nonce
            && TextValue.Filled(sub)
        if (!valid) throw new AccountError(AccountErrorKind.SignInFailed)
        return TextValue.Filled(email) ? { Subject: sub as string, Email: email } : { Subject: sub as string }
    }

    private static Payload(idToken: string): Record<string, unknown>
    {
        const parts = idToken.split(RealmIdToken.Separator)
        if (parts.length !== RealmIdToken.PartCount) throw new AccountError(AccountErrorKind.SignInFailed)
        let parsed: unknown
        try
        {
            parsed = JSON.parse(Buffer.from(parts[1], RealmIdToken.Base64Url).toString(RealmIdToken.Utf8))
        }
        catch
        {
            throw new AccountError(AccountErrorKind.SignInFailed)
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new AccountError(AccountErrorKind.SignInFailed)
        return parsed as Record<string, unknown>
    }
}
