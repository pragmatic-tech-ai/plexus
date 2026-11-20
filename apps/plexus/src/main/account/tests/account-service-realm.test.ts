import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AccountError, AccountErrorKind, PlatformAccess, TargetSource, type AccountState } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { AccountService } from '../account-service.js'
import { DesktopApiClient } from '../desktop-api-client.js'
import { DesktopSessionStore } from '../desktop-session-store.js'
import type { IRedirectReceiver } from '../loopback-redirect-receiver.js'
import { RealmTokenClient } from '../realm-sign-in.js'
import { FakeFetch, FakeRealm } from './fake-realm.js'
import { ReverseEncryptor } from './reverse-encryptor.js'

// The browser hand-back: the code is the one the realm minted for the authorize URL Plexus opened.
class RealmReceiver implements IRedirectReceiver
{
    public static readonly Uri = 'http://127.0.0.1:5555/pragmatic-desktop/callback'
    public ExpectedState: string | undefined
    public Closed = 0
    public Code: () => Promise<string> = async () => 'unset'
    private reject: ((e: unknown) => void) | undefined

    public async Start(): Promise<{ RedirectUri: string }>
    {
        return { RedirectUri: RealmReceiver.Uri }
    }

    public WaitForCode(expectedState: string): Promise<string>
    {
        this.ExpectedState = expectedState
        return new Promise((resolve, reject) =>
        {
            this.reject = reject
            // Settles after the browser was opened (the same turn the service opens it in).
            setTimeout(() => this.Code().then(resolve, reject), 0)
        })
    }

    public Cancel(): void
    {
        this.reject?.(new AccountError(AccountErrorKind.Cancelled))
    }

    public async Close(): Promise<void>
    {
        this.Closed++
    }
}

class Caught
{
    public static async Kind(work: Promise<unknown>): Promise<AccountErrorKind | undefined>
    {
        try
        {
            await work
        }
        catch (e)
        {
            return e instanceof AccountError ? e.Kind : undefined
        }
        throw new Error('expected the work to fail')
    }
}

// An in-hive tenant whose console names its realm's desktop sign-in (S4) and accepts the realm's
// access tokens on /desktop/* (S5). The platform, console and realm are fetch doubles.
class RealmHarness
{
    public static readonly Platform = 'http://localhost:7000'
    public static readonly Plane = 'http://127.0.0.1:7002'
    public static readonly Console = 'https://hive.acme.example'
    public readonly Dir = mkdtempSync(join(tmpdir(), 'account-realm-'))
    public readonly Desktop = new FakeFetch()
    public readonly RealmFetch = new FakeFetch()
    public readonly Realm = new FakeRealm(this.RealmFetch)
    public readonly Receiver = new RealmReceiver()
    public readonly Opened: string[] = []
    public readonly Changes: AccountState[] = []
    public readonly Store = new DesktopSessionStore(this.Dir, new ReverseEncryptor())
    public readonly Service: AccountService
    public Now = Date.parse('2026-11-20T12:00:00.000Z')
    public SignIn: unknown = { issuer: FakeRealm.Issuer, clientId: FakeRealm.ClientId }
    public ConsoleTenant = 't1'

    public constructor(realmTimeoutMs = 30_000)
    {
        this.Realm.NowSeconds = () => Math.floor(this.Now / 1000)
        this.Service = new AccountService(
            this.Store, this.Dir, new DesktopApiClient(this.Desktop.Fetch as typeof fetch), () => this.Receiver,
            async url => { this.Opened.push(url) }, () => this.Now, new RealmTokenClient(this.RealmFetch.Fetch as typeof fetch, () => this.Now, realmTimeoutMs),
        )
        this.Service.Changed.subscribe(s => this.Changes.push(s))
        this.Receiver.Code = async () => this.Realm.Authorize(this.Opened[this.Opened.length - 1]).Code
        const D = RealmHarness
        this.Desktop.Routes.set('/api/desktop/discover', () => FakeFetch.Json(200, {
            tenants: [{ id: 't1', displayName: 'Acme', consoleUrl: D.Console, platformEnvironments: true }], tenantPlaneUrl: D.Plane,
        }))
        this.Desktop.Routes.set(`${D.Console}/desktop/console`, () => FakeFetch.Json(200, { tenantId: this.ConsoleTenant, tenantName: 'Acme Corp', signIn: this.SignIn }))
        this.Desktop.Routes.set(`${D.Console}/desktop/targets`, r => this.Authorised(r.Headers) ? FakeFetch.Json(200, { contribute: [{ name: 'dev', status: 'running' }], publish: [] }) : FakeFetch.Json(401, {}))
        this.Desktop.Routes.set(`${D.Console}/desktop/sign-out`, () => new Response(null, { status: 204 }))
        // The transitional routes, so a fallback is observable.
        this.Desktop.Routes.set(`${D.Console}/desktop/sign-in/begin`, () => FakeFetch.Json(200, { authorizeUrl: 'https://console-idp.example/auth?state=st-legacy&code_challenge=x' }))
        this.Desktop.Routes.set(`${D.Console}/desktop/sign-in/complete`, () => FakeFetch.Json(200, { token: 'console-token', expiresAt: '2026-11-21T00:00:00.000Z', tenantId: 't1', tenantName: 'Acme' }))
    }

    // The console's resource-server check, as far as a fake can: a bearer the realm issued.
    public Authorised(headers: Record<string, string>): boolean
    {
        return (headers['authorization'] ?? '').startsWith('Bearer access-')
    }

    public async SignedIn(): Promise<AccountState>
    {
        return this.Service.SignIn(RealmHarness.Platform, 'ada@acme.example', 't1')
    }

    public async Stored(): Promise<NonNullable<Awaited<ReturnType<DesktopSessionStore['Load']>>['Console']>>
    {
        const console = (await this.Store.Load()).Console
        if (console === undefined) throw new Error('no stored console part')
        return console
    }

    public Dispose(): void
    {
        rmSync(this.Dir, { recursive: true, force: true })
    }
}

describe('AccountService on the realm path', () =>
{
    let h: RealmHarness

    beforeEach(() => { h = new RealmHarness() })
    afterEach(() => h.Dispose())

    it('signs in at the realm the console names and stores the realm grant', async () =>
    {
        const state = await h.SignedIn()
        expect(state).toEqual({ SignedIn: true, Email: 'ada@acme.example', TenantName: 'Acme Corp' })
        const authorize = new URL(h.Opened[0])
        expect(`${authorize.origin}${authorize.pathname}`).toBe(h.Realm.AuthorizeEndpoint)
        expect(h.Receiver.ExpectedState).toBe(authorize.searchParams.get('state'))
        const stored = await h.Stored()
        expect(stored.ConsoleUrl).toBe(RealmHarness.Console)
        expect(stored.TenantId).toBe('t1')
        expect(stored.Token).toMatch(/^access-/)
        expect(stored.ExpiresAt).toBe(new Date(h.Now + 600_000).toISOString())
        expect(stored.Realm).toEqual({
            Issuer: FakeRealm.Issuer, ClientId: 'plexus', RefreshToken: expect.stringMatching(/^refresh-/), TokenEndpoint: h.Realm.Token, RevocationEndpoint: h.Realm.Revoke,
            RenewAt: new Date(h.Now + 540_000).toISOString(),
        })
        expect(stored.PlatformSignInUrl).toBeUndefined()
        expect(h.Desktop.At(`${RealmHarness.Console}/desktop/sign-in/begin`)).toHaveLength(0)
        expect(h.Receiver.Closed).toBe(1)
        expect(h.Changes[h.Changes.length - 1]).toEqual(state)
    })

    it('offers no platform step on the realm path', async () =>
    {
        const state = await h.SignedIn()
        expect(state.Platform).not.toBe(PlatformAccess.Offered)
        expect(await Caught.Kind(h.Service.SignInAtPlatform())).toBe(AccountErrorKind.Unavailable)
    })

    it('signs in at the realm from a typed console address too', async () =>
    {
        const state = await h.Service.SignInAtConsole(RealmHarness.Console, 'ada@acme.example')
        expect(state).toEqual({ SignedIn: true, Email: 'ada@acme.example', TenantName: 'Acme Corp' })
        expect((await h.Stored()).Realm?.Issuer).toBe(FakeRealm.Issuer)
    })

    it('takes the email from the ID token', async () =>
    {
        h.Realm.Email = 'ada.lovelace@acme.example'
        expect((await h.SignedIn()).Email).toBe('ada.lovelace@acme.example')
    })

    it('falls back to the console-brokered sign-in when the console names no realm sign-in', async () =>
    {
        h.SignIn = undefined
        const state = await h.SignedIn()
        expect(state.SignedIn).toBe(true)
        expect((await h.Stored()).Token).toBe('console-token')
        expect((await h.Stored()).Realm).toBeUndefined()
        expect(h.RealmFetch.Requests).toHaveLength(0)
    })

    it('falls back when the console lookup fails, which then fails or succeeds as today', async () =>
    {
        h.Desktop.Routes.set(`${RealmHarness.Console}/desktop/console`, () => FakeFetch.Json(404, {}))
        expect((await h.SignedIn()).SignedIn).toBe(true)
        expect((await h.Stored()).Token).toBe('console-token')
    })

    it('refuses a console that names a realm for another tenant than the one picked', async () =>
    {
        h.ConsoleTenant = 't2'
        expect(await Caught.Kind(h.SignedIn())).toBe(AccountErrorKind.SignInFailed)
        expect(h.Opened).toHaveLength(0)
        expect((await h.Store.Load()).Console).toBeUndefined()
    })

    it('refuses an ID token for another nonce and revokes the grant it came with', async () =>
    {
        h.Receiver.Code = async () =>
        {
            const url = new URL(h.Opened[0])
            url.searchParams.set('nonce', 'not-the-one-sent')
            return h.Realm.Authorize(url.toString()).Code
        }
        expect(await Caught.Kind(h.SignedIn())).toBe(AccountErrorKind.SignInFailed)
        expect(h.Realm.Revoked).toHaveLength(1)
        expect((await h.Store.Load()).Console).toBeUndefined()
    })

    it('a cancel while the code is exchanged revokes the fresh grant and stores nothing', async () =>
    {
        const exchange = h.RealmFetch.Routes.get(h.Realm.Token)!
        h.RealmFetch.Routes.set(h.Realm.Token, async r =>
        {
            await h.Service.CancelSignIn()
            return exchange(r)
        })
        expect(await Caught.Kind(h.SignedIn())).toBe(AccountErrorKind.Cancelled)
        expect(h.Realm.Revoked).toHaveLength(1)
        expect((await h.Store.Load()).Console).toBeUndefined()
    })

    it('a realm the desktop cannot reach is ConsoleUnreachable', async () =>
    {
        h.RealmFetch.Routes.clear()
        expect(await Caught.Kind(h.SignedIn())).toBe(AccountErrorKind.ConsoleUnreachable)
        expect(h.Opened).toHaveLength(0)
    })

    it('lists targets with the realm access token as the bearer', async () =>
    {
        await h.SignedIn()
        const targets = await h.Service.Targets()
        expect(targets.Contribute.map(t => t.Name)).toEqual(['dev'])
        const [call] = h.Desktop.At(`${RealmHarness.Console}/desktop/targets`)
        expect(call.Headers['authorization']).toBe(`Bearer ${(await h.Stored()).Token}`)
        expect(h.Realm.Refreshes).toBe(0)
    })

    it('refreshes an access token about to expire before using it, and stores the rotated grant', async () =>
    {
        await h.SignedIn()
        const before = await h.Stored()
        h.Now += 560_000
        const session = await h.Service.SessionFor(TargetSource.Console)
        const after = await h.Stored()
        expect(h.Realm.Refreshes).toBe(1)
        expect(session).toEqual({ ConsoleUrl: RealmHarness.Console, Token: after.Token })
        expect(after.Token).not.toBe(before.Token)
        expect(after.Realm?.RefreshToken).not.toBe(before.Realm?.RefreshToken)
        expect(after.ExpiresAt).toBe(new Date(h.Now + 600_000).toISOString())
        await h.Service.Targets()
        expect(h.Realm.Refreshes).toBe(1)
    })

    it('runs one refresh for concurrent callers (a reused refresh token would revoke the family)', async () =>
    {
        await h.SignedIn()
        h.Now += 590_000
        const sessions = await Promise.all([h.Service.SessionFor(TargetSource.Console), h.Service.SessionFor(TargetSource.Console), h.Service.Targets()])
        expect(h.Realm.Refreshes).toBe(1)
        expect(sessions[0]).toEqual(sessions[1])
        expect(h.Realm.IsLive((await h.Stored()).Realm!.RefreshToken)).toBe(true)
    })

    it('signs out when the realm refuses the refresh', async () =>
    {
        await h.SignedIn()
        h.Now += 600_000
        h.Realm.TokenOverride = () => FakeFetch.Json(400, { error: 'invalid_grant' })
        expect(await Caught.Kind(h.Service.Targets())).toBe(AccountErrorKind.SignedOut)
        expect((await h.Store.Load()).Console).toBeUndefined()
        expect(h.Changes[h.Changes.length - 1]).toEqual({ SignedIn: false })
        expect(await h.Service.SessionFor(TargetSource.Console)).toBeUndefined()
    })

    it('keeps the session when the realm cannot be reached for a refresh', async () =>
    {
        await h.SignedIn()
        h.Now += 600_000
        h.Realm.TokenOverride = () => { throw new TypeError('fetch failed') }
        expect(await Caught.Kind(h.Service.SessionFor(TargetSource.Console))).toBe(AccountErrorKind.ConsoleUnreachable)
        expect((await h.Store.Load()).Console?.Realm).toBeDefined()
    })

    it('sign-out clears locally, revokes the refresh token and tells the console', async () =>
    {
        await h.SignedIn()
        const stored = await h.Stored()
        expect(await h.Service.SignOut()).toEqual({ SignedIn: false })
        expect((await h.Store.Load()).Console).toBeUndefined()
        expect(h.Realm.Revoked).toEqual([stored.Realm!.RefreshToken])
        const [signOut] = h.Desktop.At(`${RealmHarness.Console}/desktop/sign-out`)
        expect(signOut.Headers['authorization']).toBe(`Bearer ${stored.Token}`)
    })

    it('sign-out still clears when the realm and console are gone', async () =>
    {
        await h.SignedIn()
        h.RealmFetch.Routes.clear()
        h.Desktop.Routes.clear()
        expect(await h.Service.SignOut()).toEqual({ SignedIn: false })
        expect((await h.Store.Load()).Console).toBeUndefined()
    })

    it('a 401 for the realm token renews once and retries (the desktop clock may run behind)', async () =>
    {
        await h.SignedIn()
        const stored = await h.Stored()
        let refusals = 1
        h.Desktop.Routes.set(`${RealmHarness.Console}/desktop/targets`, r => refusals-- > 0 || !h.Authorised(r.Headers) ? FakeFetch.Json(401, {}) : FakeFetch.Json(200, { contribute: [], publish: [] }))
        expect(await h.Service.Targets()).toEqual({ Contribute: [], Publish: [] })
        expect(h.Realm.Refreshes).toBe(1)
        expect((await h.Stored()).Token).not.toBe(stored.Token)
        expect(h.Realm.Revoked).toEqual([])
    })

    it('a second 401 after the renewal drops the session and revokes its grant', async () =>
    {
        await h.SignedIn()
        h.Desktop.Routes.set(`${RealmHarness.Console}/desktop/targets`, () => FakeFetch.Json(401, {}))
        expect(await Caught.Kind(h.Service.Targets())).toBe(AccountErrorKind.SignedOut)
        expect((await h.Store.Load()).Console).toBeUndefined()
        expect(h.Realm.Revoked).toHaveLength(1)
        expect(h.Realm.IsLive(h.Realm.Revoked[0])).toBe(false)
        expect(h.Changes[h.Changes.length - 1]).toEqual({ SignedIn: false })
    })

    it('a 401 for a token already replaced changes and revokes nothing', async () =>
    {
        await h.SignedIn()
        const old = (await h.Stored()).Token
        h.Now += 560_000
        await h.Service.SessionFor(TargetSource.Console)
        await h.Service.HandleSignedOut(old)
        const stored = await h.Stored()
        expect(await h.Service.Renew(old)).toEqual({ ConsoleUrl: stored.ConsoleUrl, Token: stored.Token })
        expect((await h.Store.Load()).Console?.Realm).toBeDefined()
        expect(h.Realm.Revoked).toEqual([])
        expect(h.Realm.Refreshes).toBe(1)
    })

    it('a 401 that raced a renewal retries with the stored newer token, still signed in', async () =>
    {
        await h.SignedIn()
        const old = (await h.Stored()).Token
        let first = true
        h.Desktop.Routes.set(`${RealmHarness.Console}/desktop/targets`, async r =>
        {
            if (first)
            {
                first = false
                // Another caller renews meanwhile; the console then refuses the old token.
                h.Now += 560_000
                await h.Service.SessionFor(TargetSource.Console)
                return FakeFetch.Json(401, {})
            }
            return r.Headers['authorization'] === `Bearer ${old}` ? FakeFetch.Json(401, {}) : FakeFetch.Json(200, { contribute: [], publish: [] })
        })
        expect(await h.Service.Targets()).toEqual({ Contribute: [], Publish: [] })
        expect(h.Realm.Refreshes).toBe(1)
        expect((await h.Store.Load()).Console?.Realm).toBeDefined()
        expect(h.Realm.Revoked).toEqual([])
    })

    it('callers arriving during a renewal share it, so an unreachable realm costs one attempt', async () =>
    {
        await h.SignedIn()
        h.Now += 600_000
        let release: () => void = () => undefined
        h.RealmFetch.Routes.set(h.Realm.Token, async () =>
        {
            await new Promise<void>(resolve => { release = resolve })
            throw new TypeError('fetch failed')
        })
        const first = h.Service.SessionFor(TargetSource.Console)
        while (h.RealmFetch.At(h.Realm.Token).length < 2) await new Promise(r => setTimeout(r, 1))
        const others = [h.Service.SessionFor(TargetSource.Console), h.Service.Targets()]
        release()
        for (const call of [first, ...others])
        {
            expect(await Caught.Kind(call)).toBe(AccountErrorKind.ConsoleUnreachable)
        }
        expect(h.RealmFetch.At(h.Realm.Token)).toHaveLength(2)
        expect((await h.Store.Load()).Console?.Realm).toBeDefined()
    })

    it('keeps the session when a refresh meets a server error', async () =>
    {
        await h.SignedIn()
        h.Now += 600_000
        h.Realm.TokenOverride = () => FakeFetch.Json(500, {})
        expect(await Caught.Kind(h.Service.SessionFor(TargetSource.Console))).toBe(AccountErrorKind.Unavailable)
        h.Realm.TokenOverride = () => FakeFetch.Json(400, { error: 'invalid_request' })
        expect(await Caught.Kind(h.Service.SessionFor(TargetSource.Console))).toBe(AccountErrorKind.Unavailable)
        expect((await h.Store.Load()).Console?.Realm).toBeDefined()
    })

    it('renews a short-lived token at half its lifetime, not on every use', async () =>
    {
        h.Realm.ExpiresIn = 60
        await h.SignedIn()
        expect((await h.Stored()).Realm?.RenewAt).toBe(new Date(h.Now + 30_000).toISOString())
        await h.Service.SessionFor(TargetSource.Console)
        expect(h.Realm.Refreshes).toBe(0)
        h.Now += 30_000
        await h.Service.SessionFor(TargetSource.Console)
        expect(h.Realm.Refreshes).toBe(1)
    })

    it('a cancel during the browser wait stores nothing and exchanges no code', async () =>
    {
        h.Receiver.Code = () => new Promise(() => undefined)
        const signIn = h.SignedIn()
        while (h.Opened.length === 0) await new Promise(r => setTimeout(r, 1))
        await h.Service.CancelSignIn()
        expect(await Caught.Kind(signIn)).toBe(AccountErrorKind.Cancelled)
        expect(h.RealmFetch.At(h.Realm.Token)).toHaveLength(0)
        expect((await h.Store.Load()).Console).toBeUndefined()
    })

    it('a cancel while the realm document is read never opens the browser', async () =>
    {
        const discovery = h.RealmFetch.Routes.get(`${FakeRealm.Issuer}/.well-known/openid-configuration`)!
        h.RealmFetch.Routes.set(`${FakeRealm.Issuer}/.well-known/openid-configuration`, async r =>
        {
            await h.Service.CancelSignIn()
            return discovery(r)
        })
        expect(await Caught.Kind(h.SignedIn())).toBe(AccountErrorKind.Cancelled)
        expect(h.Opened).toHaveLength(0)
    })

    it('never looks a tenant-plane console up (the plane is the transitional path)', async () =>
    {
        h.Desktop.Routes.set('/api/desktop/discover', () => FakeFetch.Json(200, { tenants: [{ id: 't1', displayName: 'Acme' }], tenantPlaneUrl: RealmHarness.Plane }))
        h.Desktop.Routes.set(`${RealmHarness.Plane}/desktop/sign-in/begin`, () => FakeFetch.Json(200, { authorizeUrl: 'https://plane-idp.example/auth?state=st-plane&code_challenge=x' }))
        h.Desktop.Routes.set(`${RealmHarness.Plane}/desktop/sign-in/complete`, () => FakeFetch.Json(200, { token: 'plane-token', expiresAt: '2026-11-21T00:00:00.000Z', tenantId: 't1', tenantName: 'Acme' }))
        h.Receiver.Code = async () => 'plane-code'
        await h.SignedIn()
        expect(h.Desktop.Requests.filter(r => new URL(r.Url).pathname === '/desktop/console')).toHaveLength(0)
        expect((await h.Stored()).Token).toBe('plane-token')
    })

    it('a grant the store cannot keep is revoked', async () =>
    {
        h.Store.Save = async () => { throw new Error('disk full') }
        expect(await Caught.Kind(h.SignedIn())).toBeUndefined()
        expect(h.Realm.Revoked).toHaveLength(1)
        expect(h.Realm.IsLive(h.Realm.Revoked[0])).toBe(false)
    })

    it('a renewal the store cannot keep fails the call (the spent refresh token then signs out next time)', async () =>
    {
        await h.SignedIn()
        const save = h.Store.Save.bind(h.Store)
        h.Store.Save = async () => { throw new Error('disk full') }
        h.Now += 600_000
        await expect(h.Service.SessionFor(TargetSource.Console)).rejects.toThrow('disk full')
        h.Store.Save = save
        expect(await Caught.Kind(h.Service.SessionFor(TargetSource.Console))).toBe(AccountErrorKind.SignedOut)
    })

    it('a new sign-in revokes the grant it replaces', async () =>
    {
        await h.SignedIn()
        const first = await h.Stored()
        await h.SignedIn()
        expect(h.Realm.Revoked).toEqual([first.Realm!.RefreshToken])
        expect(h.Realm.IsLive((await h.Stored()).Realm!.RefreshToken)).toBe(true)
    })
})

describe('AccountService with a realm that never answers', () =>
{
    it('a hanging refresh gives up and never holds sign-out for long', async () =>
    {
        const h = new RealmHarness(50)
        try
        {
            await h.SignedIn()
            h.Now += 600_000
            h.RealmFetch.Routes.set(h.Realm.Token, () => new Promise<Response>(() => undefined))
            const refresh = h.Service.SessionFor(TargetSource.Console)
            // Sign-out arrives while the refresh is in flight at the realm.
            while (h.RealmFetch.At(h.Realm.Token).length < 2) await new Promise(r => setTimeout(r, 1))
            const signOut = h.Service.SignOut()
            expect(await Caught.Kind(refresh)).toBe(AccountErrorKind.ConsoleUnreachable)
            expect(await signOut).toEqual({ SignedIn: false })
            expect((await h.Store.Load()).Console).toBeUndefined()
        }
        finally
        {
            h.Dispose()
        }
    })
})

