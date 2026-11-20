import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AccountError, AccountErrorKind } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { RealmAuthorization, RealmGrantRefused, RealmIdToken, RealmProvider, RealmTokenClient } from '../realm-sign-in.js'
import type { RealmGrant } from '../desktop-session-store.js'
import { FakeFetch, FakeRealm } from './fake-realm.js'

class Caught
{
    public static async Of(work: Promise<unknown>): Promise<unknown>
    {
        try
        {
            await work
        }
        catch (e)
        {
            return e
        }
        throw new Error('expected the work to fail')
    }

    public static async Kind(work: Promise<unknown>): Promise<AccountErrorKind | undefined>
    {
        const e = await Caught.Of(work)
        return e instanceof AccountError ? e.Kind : undefined
    }

    public static KindOfSync(work: () => unknown): AccountErrorKind | undefined
    {
        try
        {
            work()
        }
        catch (e)
        {
            return e instanceof AccountError ? e.Kind : undefined
        }
        throw new Error('expected the work to fail')
    }
}

const Redirect = 'http://127.0.0.1:5555/pragmatic-desktop/callback'

describe('RealmProvider', () =>
{
    let fetch: FakeFetch
    let realm: FakeRealm

    beforeEach(() =>
    {
        fetch = new FakeFetch()
        realm = new FakeRealm(fetch)
    })

    function Document(patch: Record<string, unknown>): void
    {
        fetch.Routes.set(`${FakeRealm.Issuer}/.well-known/openid-configuration`, () => FakeFetch.Json(200, { ...realm.Discovery(), ...patch }))
    }

    it('reads the endpoints from the issuer discovery document', async () =>
    {
        const provider = await RealmProvider.Discover(FakeRealm.Issuer, fetch.Fetch as typeof globalThis.fetch)
        expect(provider.Issuer).toBe(FakeRealm.Issuer)
        expect(provider.AuthorizationEndpoint).toBe(realm.AuthorizeEndpoint)
        expect(provider.TokenEndpoint).toBe(realm.Token)
        expect(provider.RevocationEndpoint).toBe(realm.Revoke)
        expect(fetch.Requests[0].Url).toBe(`${FakeRealm.Issuer}/.well-known/openid-configuration`)
    })

    it('compares the issuer exactly as named (a trailing slash is part of it)', async () =>
    {
        expect(await Caught.Kind(RealmProvider.Discover(`${FakeRealm.Issuer}/`, fetch.Fetch as typeof globalThis.fetch))).toBe(AccountErrorKind.Unavailable)
        const slashed = new FakeFetch()
        const withSlash = new FakeRealm(slashed, 'https://hive.acme.example/realms/acme')
        slashed.Routes.set(`${FakeRealm.Issuer}/.well-known/openid-configuration`, () => FakeFetch.Json(200, { ...withSlash.Discovery(), issuer: `${FakeRealm.Issuer}/` }))
        const provider = await RealmProvider.Discover(`${FakeRealm.Issuer}/`, slashed.Fetch as typeof globalThis.fetch)
        expect(provider.Issuer).toBe(`${FakeRealm.Issuer}/`)
    })

    it('gives up on a realm that never answers (console unreachable)', async () =>
    {
        const hanging = (_input: string | URL, init?: RequestInit): Promise<Response> => new Promise((_resolve, reject) =>
        {
            init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
        })
        expect(await Caught.Kind(RealmProvider.Discover(FakeRealm.Issuer, hanging as typeof globalThis.fetch, 20))).toBe(AccountErrorKind.ConsoleUnreachable)
    })

    it('refuses a document naming another issuer', async () =>
    {
        Document({ issuer: 'https://evil.example/realms/acme' })
        expect(await Caught.Kind(RealmProvider.Discover(FakeRealm.Issuer, fetch.Fetch as typeof globalThis.fetch))).toBe(AccountErrorKind.Unavailable)
    })

    it('refuses a cleartext endpoint off loopback', async () =>
    {
        Document({ token_endpoint: 'http://hive.acme.example/token' })
        expect(await Caught.Kind(RealmProvider.Discover(FakeRealm.Issuer, fetch.Fetch as typeof globalThis.fetch))).toBe(AccountErrorKind.Unavailable)
    })

    it('refuses a cleartext issuer off loopback before dialling it', async () =>
    {
        expect(await Caught.Kind(RealmProvider.Discover('http://hive.acme.example/realms/acme', fetch.Fetch as typeof globalThis.fetch))).toBe(AccountErrorKind.Unavailable)
        expect(fetch.Requests).toHaveLength(0)
    })

    it('accepts cleartext on loopback (development stacks)', async () =>
    {
        const local = new FakeRealm(fetch, 'http://127.0.0.1:7443/realms/dev')
        const provider = await RealmProvider.Discover('http://127.0.0.1:7443/realms/dev', fetch.Fetch as typeof globalThis.fetch)
        expect(provider.TokenEndpoint).toBe(local.Token)
    })

    it('refuses a document without a token endpoint', async () =>
    {
        Document({ token_endpoint: undefined })
        expect(await Caught.Kind(RealmProvider.Discover(FakeRealm.Issuer, fetch.Fetch as typeof globalThis.fetch))).toBe(AccountErrorKind.Unavailable)
    })

    it('refuses challenge methods that leave out S256', async () =>
    {
        Document({ code_challenge_methods_supported: ['plain'] })
        expect(await Caught.Kind(RealmProvider.Discover(FakeRealm.Issuer, fetch.Fetch as typeof globalThis.fetch))).toBe(AccountErrorKind.Unavailable)
    })

    it('accepts a document that lists no challenge methods and no revocation endpoint', async () =>
    {
        Document({ code_challenge_methods_supported: undefined, revocation_endpoint: undefined })
        const provider = await RealmProvider.Discover(FakeRealm.Issuer, fetch.Fetch as typeof globalThis.fetch)
        expect(provider.RevocationEndpoint).toBeUndefined()
    })

    it('answers console unreachable when the realm cannot be reached', async () =>
    {
        fetch.Routes.clear()
        expect(await Caught.Kind(RealmProvider.Discover(FakeRealm.Issuer, fetch.Fetch as typeof globalThis.fetch))).toBe(AccountErrorKind.ConsoleUnreachable)
    })

    it('tells an untrusted certificate apart', async () =>
    {
        const tls = Object.assign(new TypeError('fetch failed'), { cause: { code: 'SELF_SIGNED_CERT_IN_CHAIN' } })
        const failing = async (): Promise<Response> => { throw tls }
        expect(await Caught.Kind(RealmProvider.Discover(FakeRealm.Issuer, failing as typeof globalThis.fetch))).toBe(AccountErrorKind.CertificateUntrusted)
    })

    it('refuses an answer that is not a JSON object', async () =>
    {
        fetch.Routes.set(`${FakeRealm.Issuer}/.well-known/openid-configuration`, () => new Response('<html>', { status: 200 }))
        expect(await Caught.Kind(RealmProvider.Discover(FakeRealm.Issuer, fetch.Fetch as typeof globalThis.fetch))).toBe(AccountErrorKind.Unavailable)
        fetch.Routes.set(`${FakeRealm.Issuer}/.well-known/openid-configuration`, () => FakeFetch.Json(404, {}))
        expect(await Caught.Kind(RealmProvider.Discover(FakeRealm.Issuer, fetch.Fetch as typeof globalThis.fetch))).toBe(AccountErrorKind.Unavailable)
    })

    it('never follows a redirect', async () =>
    {
        const seen: RequestInit[] = []
        const recording = async (input: string | URL, init?: RequestInit): Promise<Response> => { seen.push(init ?? {}); return fetch.Fetch(input, init) }
        await RealmProvider.Discover(FakeRealm.Issuer, recording as typeof globalThis.fetch)
        expect(seen[0].redirect).toBe('error')
    })
})

describe('RealmAuthorization', () =>
{
    let provider: RealmProvider

    beforeEach(async () =>
    {
        const fetch = new FakeFetch()
        new FakeRealm(fetch)
        provider = await RealmProvider.Discover(FakeRealm.Issuer, fetch.Fetch as typeof globalThis.fetch)
    })

    it('builds the authorization code request with PKCE S256, state and nonce', () =>
    {
        const request = RealmAuthorization.Create(provider, FakeRealm.ClientId, Redirect)
        const url = new URL(request.Url())
        const p = url.searchParams
        expect(`${url.origin}${url.pathname}`).toBe(provider.AuthorizationEndpoint)
        expect(p.get('response_type')).toBe('code')
        expect(p.get('client_id')).toBe('plexus')
        expect(p.get('redirect_uri')).toBe(Redirect)
        expect(p.get('scope')).toBe('openid email profile offline_access')
        expect(p.get('code_challenge_method')).toBe('S256')
        expect(p.get('code_challenge')).toBe(createHash('sha256').update(request.Verifier).digest('base64url'))
        expect(p.get('state')).toBe(request.State)
        expect(p.get('nonce')).toBe(request.Nonce)
        expect(request.Verifier.length).toBeGreaterThanOrEqual(43)
    })

    it('uses fresh secrets for every request', () =>
    {
        const a = RealmAuthorization.Create(provider, FakeRealm.ClientId, Redirect)
        const b = RealmAuthorization.Create(provider, FakeRealm.ClientId, Redirect)
        expect(a.Verifier).not.toBe(b.Verifier)
        expect(a.State).not.toBe(b.State)
        expect(a.Nonce).not.toBe(b.Nonce)
    })

    it('keeps a query the authorization endpoint already carries', async () =>
    {
        const fetch = new FakeFetch()
        const realm = new FakeRealm(fetch)
        fetch.Routes.set(`${FakeRealm.Issuer}/.well-known/openid-configuration`, () => FakeFetch.Json(200, { ...realm.Discovery(), authorization_endpoint: `${realm.AuthorizeEndpoint}?kc_idp_hint=google` }))
        const withQuery = await RealmProvider.Discover(FakeRealm.Issuer, fetch.Fetch as typeof globalThis.fetch)
        const url = new URL(RealmAuthorization.Create(withQuery, FakeRealm.ClientId, Redirect).Url())
        expect(url.searchParams.get('kc_idp_hint')).toBe('google')
        expect(url.searchParams.get('client_id')).toBe('plexus')
    })
})

describe('RealmIdToken', () =>
{
    const Now = Date.parse('2026-11-20T12:00:00.000Z')
    const Seconds = Math.floor(Now / 1000)

    function Claims(patch: Record<string, unknown> = {}): string
    {
        return FakeRealm.IdToken({ iss: FakeRealm.Issuer, aud: 'plexus', azp: 'plexus', sub: 'acct-1', email: 'ada@acme.example', iat: Seconds, exp: Seconds + 300, nonce: 'n-1', ...patch })
    }

    function Check(token: string): unknown
    {
        return RealmIdToken.Check(token, FakeRealm.Issuer, 'plexus', 'n-1', Now)
    }

    it('answers the subject and email of a token that passes every check', () =>
    {
        expect(Check(Claims())).toEqual({ Subject: 'acct-1', Email: 'ada@acme.example' })
    })

    it('accepts an audience array containing the client when azp names the client', () =>
    {
        expect(Check(Claims({ aud: ['plexus', 'pragmatic-tenant-admin'] }))).toEqual({ Subject: 'acct-1', Email: 'ada@acme.example' })
    })

    it('accepts a single audience without azp', () =>
    {
        expect(Check(Claims({ azp: undefined }))).toEqual({ Subject: 'acct-1', Email: 'ada@acme.example' })
    })

    it('refuses several audiences without azp (OIDC Core 3.1.3.7)', () =>
    {
        expect(Caught.KindOfSync(() => Check(Claims({ aud: ['plexus', 'pragmatic-tenant-admin'], azp: undefined })))).toBe(AccountErrorKind.SignInFailed)
    })

    it('leaves the email out when the token has none', () =>
    {
        expect(Check(Claims({ email: undefined }))).toEqual({ Subject: 'acct-1' })
    })

    it.each([
        ['another issuer', { iss: 'https://evil.example/realms/acme' }],
        ['another audience', { aud: 'console' }],
        ['another authorized party', { azp: 'console' }],
        ['an expired token', { exp: Seconds - 61 }],
        ['a token from the future', { iat: Seconds + 61 }],
        ['another nonce', { nonce: 'n-2' }],
        ['no nonce', { nonce: undefined }],
        ['no subject', { sub: '' }],
        ['a non-numeric expiry', { exp: 'tomorrow' }],
    ])('refuses %s', (_name, patch) =>
    {
        expect(Caught.KindOfSync(() => Check(Claims(patch)))).toBe(AccountErrorKind.SignInFailed)
    })

    it('allows 60 seconds of clock skew', () =>
    {
        expect(Check(Claims({ exp: Seconds - 30, iat: Seconds + 30 }))).toEqual({ Subject: 'acct-1', Email: 'ada@acme.example' })
    })

    it.each([['not three parts', 'a.b'], ['a payload that is not JSON', 'a.bm90IGpzb24.c'], ['a payload that is not an object', `a.${Buffer.from('[1]').toString('base64url')}.c`]])('refuses %s', (_name, token) =>
    {
        expect(Caught.KindOfSync(() => Check(token))).toBe(AccountErrorKind.SignInFailed)
    })
})

describe('RealmTokenClient', () =>
{
    const Now = Date.parse('2026-11-20T12:00:00.000Z')
    let fetch: FakeFetch
    let realm: FakeRealm
    let provider: RealmProvider
    let client: RealmTokenClient

    beforeEach(async () =>
    {
        fetch = new FakeFetch()
        realm = new FakeRealm(fetch)
        provider = await RealmProvider.Discover(FakeRealm.Issuer, fetch.Fetch as typeof globalThis.fetch)
        client = new RealmTokenClient(fetch.Fetch as typeof globalThis.fetch, () => Now)
    })

    function Grant(refreshToken: string): RealmGrant
    {
        return { Issuer: FakeRealm.Issuer, ClientId: FakeRealm.ClientId, RefreshToken: refreshToken, TokenEndpoint: realm.Token, RevocationEndpoint: realm.Revoke, RenewAt: '' }
    }

    async function SignedIn(): Promise<{ Refresh: string; Access: string }>
    {
        const request = RealmAuthorization.Create(provider, FakeRealm.ClientId, Redirect)
        const done = await client.ExchangeCode(request, realm.Authorize(request.Url()).Code)
        return { Refresh: done.RefreshToken, Access: done.AccessToken }
    }

    it('exchanges the code as a public client with the verifier and redirect URI', async () =>
    {
        const request = RealmAuthorization.Create(provider, FakeRealm.ClientId, Redirect)
        const code = realm.Authorize(request.Url()).Code
        const done = await client.ExchangeCode(request, code)
        const sent = fetch.At(realm.Token)[0]
        expect(sent.Method).toBe('POST')
        expect(sent.Headers['content-type']).toContain('application/x-www-form-urlencoded')
        expect(sent.Headers['authorization']).toBeUndefined()
        expect(Object.fromEntries(sent.Form!.entries())).toEqual({ grant_type: 'authorization_code', code, redirect_uri: Redirect, client_id: 'plexus', code_verifier: request.Verifier })
        expect(done.AccessToken).toMatch(/^access-/)
        expect(done.RefreshToken).toMatch(/^refresh-/)
        expect(done.ExpiresAt).toBe(new Date(Now + 600_000).toISOString())
        expect(RealmIdToken.Check(done.IdToken, FakeRealm.Issuer, 'plexus', request.Nonce, Date.now()).Subject).toBe('acct-1')
    })

    it('revokes a refresh token that came in an answer it cannot use', async () =>
    {
        realm.TokenOverride = () => FakeFetch.Json(200, { access_token: 'a', token_type: 'Bearer', expires_in: 60, refresh_token: 'stray-refresh' })
        const request = RealmAuthorization.Create(provider, FakeRealm.ClientId, Redirect)
        expect(await Caught.Kind(client.ExchangeCode(request, 'c'))).toBe(AccountErrorKind.Unavailable)
        expect(realm.Revoked).toEqual(['stray-refresh'])
    })

    it('reports the lifetime of the access token', async () =>
    {
        const request = RealmAuthorization.Create(provider, FakeRealm.ClientId, Redirect)
        const done = await client.ExchangeCode(request, realm.Authorize(request.Url()).Code)
        expect(done.LifetimeMs).toBe(600_000)
    })

    it('answers sign-in failed when the realm refuses the code', async () =>
    {
        const request = RealmAuthorization.Create(provider, FakeRealm.ClientId, Redirect)
        expect(await Caught.Kind(client.ExchangeCode(request, 'not-a-code'))).toBe(AccountErrorKind.SignInFailed)
    })

    it.each([
        ['no refresh token', { refresh_token: undefined }],
        ['no ID token', { id_token: undefined }],
        ['another token type', { token_type: 'mac' }],
        ['no expiry', { expires_in: undefined }],
        ['a zero expiry', { expires_in: 0 }],
    ])('refuses an exchange answer with %s', async (_name, patch) =>
    {
        realm.TokenOverride = () => FakeFetch.Json(200, { access_token: 'a', token_type: 'Bearer', expires_in: 60, refresh_token: 'r', id_token: 'x.y.z', ...patch })
        const request = RealmAuthorization.Create(provider, FakeRealm.ClientId, Redirect)
        expect(await Caught.Kind(client.ExchangeCode(request, 'c'))).toBe(AccountErrorKind.Unavailable)
    })

    it('rotates the refresh token on refresh', async () =>
    {
        const { Refresh } = await SignedIn()
        const next = await client.Refresh(Grant(Refresh))
        expect(next.RefreshToken).toMatch(/^refresh-/)
        expect(next.RefreshToken).not.toBe(Refresh)
        expect(realm.IsLive(Refresh)).toBe(false)
        expect(Object.fromEntries(fetch.At(realm.Token)[1].Form!.entries())).toEqual({ grant_type: 'refresh_token', refresh_token: Refresh, client_id: 'plexus' })
    })

    it('keeps the old refresh token when a refresh answers none', async () =>
    {
        realm.TokenOverride = () => FakeFetch.Json(200, { access_token: 'a2', token_type: 'Bearer', expires_in: 60 })
        const next = await client.Refresh(Grant('r1'))
        expect(next.RefreshToken).toBeUndefined()
        expect(next.AccessToken).toBe('a2')
    })

    it('answers a typed refusal when the realm refuses the grant', async () =>
    {
        expect(await Caught.Of(client.Refresh(Grant('unknown')))).toBeInstanceOf(RealmGrantRefused)
        realm.TokenOverride = () => FakeFetch.Json(401, { error: 'invalid_client' })
        expect(await Caught.Of(client.Refresh(Grant('unknown')))).toBeInstanceOf(RealmGrantRefused)
    })

    it('answers console unreachable when the realm cannot be reached, unavailable on a server error', async () =>
    {
        realm.TokenOverride = () => { throw new TypeError('fetch failed') }
        expect(await Caught.Kind(client.Refresh(Grant('r')))).toBe(AccountErrorKind.ConsoleUnreachable)
        realm.TokenOverride = () => FakeFetch.Json(503, {})
        expect(await Caught.Kind(client.Refresh(Grant('r')))).toBe(AccountErrorKind.Unavailable)
    })

    it('revokes the refresh token at the revocation endpoint', async () =>
    {
        const { Refresh } = await SignedIn()
        await client.Revoke(Grant(Refresh))
        expect(realm.Revoked).toEqual([Refresh])
        expect(Object.fromEntries(fetch.At(realm.Revoke)[0].Form!.entries())).toEqual({ token: Refresh, token_type_hint: 'refresh_token', client_id: 'plexus' })
    })

    it('has nothing to revoke at without a revocation endpoint', async () =>
    {
        await client.Revoke({ ...Grant('r'), RevocationEndpoint: undefined })
        expect(fetch.At(realm.Revoke)).toHaveLength(0)
    })
})
