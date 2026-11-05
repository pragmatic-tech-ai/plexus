import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AccountError, AccountErrorKind, TargetKind, TargetStatus, type AccountState } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { AccountService } from '../account-service.js'
import { DesktopApiClient } from '../desktop-api-client.js'
import { DesktopSessionStore } from '../desktop-session-store.js'
import type { IRedirectReceiver } from '../loopback-redirect-receiver.js'
import { ReverseEncryptor } from './reverse-encryptor.js'

type Recorded = { Url: string; Method: string; Headers: Record<string, string>; Body: Record<string, unknown> | undefined }
type Route = () => Response | Promise<Response>

// A fetch double keyed by path. A route that is missing answers a network failure, like an
// unreachable host.
class FakeFetch
{
    public readonly Requests: Recorded[] = []
    public readonly Routes = new Map<string, Route>()

    public readonly Fetch = async (input: string | URL, init?: RequestInit): Promise<Response> =>
    {
        const url = String(input)
        const headers = Object.fromEntries(new Headers(init?.headers).entries())
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined
        this.Requests.push({ Url: url, Method: init?.method ?? 'GET', Headers: headers, Body: body })
        const route = this.Routes.get(new URL(url).pathname)
        if (route === undefined) throw new TypeError('fetch failed')
        return await route()
    }

    public static Json(status: number, body: unknown): Response
    {
        return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    }

    public To(path: string): Recorded[]
    {
        return this.Requests.filter(r => new URL(r.Url).pathname === path)
    }
}

class FakeReceiver implements IRedirectReceiver
{
    public static readonly Uri = 'http://127.0.0.1:5555/pragmatic-desktop/callback'
    public ExpectedState: string | undefined
    public Closed = 0
    public Started = 0
    public Cancelled = false
    public Outcome: () => Promise<string> = async () => 'the-code'
    private reject: ((e: unknown) => void) | undefined

    public async Start(): Promise<{ RedirectUri: string }> { this.Started++; return { RedirectUri: FakeReceiver.Uri } }

    public WaitForCode(expectedState: string): Promise<string>
    {
        this.ExpectedState = expectedState
        return new Promise((resolve, reject) =>
        {
            this.reject = reject
            this.Outcome().then(resolve, reject)
        })
    }

    public Cancel(): void
    {
        this.Cancelled = true
        this.reject?.(new AccountError(AccountErrorKind.Cancelled))
    }

    public async Close(): Promise<void> { this.Closed++ }
}

// A promise the test releases by hand, to hold a request in flight.
class Gate
{
    public Release: () => void = () => undefined
    public readonly Opened = new Promise<void>(resolve => { this.Release = resolve })
}

class Harness
{
    public static readonly Platform = 'http://localhost:7000'
    public static readonly Plane = 'http://127.0.0.1:7002'
    public static readonly Authorize = 'https://idp.example/realms/t/authorize?client_id=plexus&state=st-123&code_challenge=x'
    public readonly Dir = mkdtempSync(join(tmpdir(), 'account-service-'))
    public readonly Fetch = new FakeFetch()
    public readonly Receiver = new FakeReceiver()
    public readonly Opened: string[] = []
    public readonly Changes: AccountState[] = []
    public readonly Encryptor = new ReverseEncryptor()
    public readonly Store = new DesktopSessionStore(this.Dir, this.Encryptor)
    public readonly Service: AccountService

    public constructor()
    {
        this.Service = new AccountService(this.Store, this.Dir, new DesktopApiClient(this.Fetch.Fetch as typeof fetch), () => this.Receiver, async url => { this.Opened.push(url) })
        this.Service.Changed.subscribe(s => this.Changes.push(s))
        this.Tenant('t1', 'Acme', 'ada@acme.example')
    }

    // Points discovery + sign-in at one tenant; the issued token names the tenant.
    public Tenant(id: string, name: string, email: string): void
    {
        this.Fetch.Routes.set('/api/desktop/discover', () => FakeFetch.Json(200, { tenants: [{ id, displayName: name }], tenantPlaneUrl: Harness.Plane }))
        this.Fetch.Routes.set('/desktop/sign-in/begin', () => FakeFetch.Json(200, { authorizeUrl: Harness.Authorize }))
        this.Fetch.Routes.set('/desktop/sign-in/complete', () => FakeFetch.Json(200, { token: `secret-token-${id}`, expiresAt: '2026-11-11T00:00:00.000Z', tenantId: id, tenantName: name, email }))
    }

    public async SignIn(tenantId = 't1', email = 'ada@acme.example'): Promise<AccountState>
    {
        return this.Service.SignIn(Harness.Platform, email, tenantId)
    }

    public Dispose(): void
    {
        rmSync(this.Dir, { recursive: true, force: true })
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

describe('AccountService', () =>
{
    let h: Harness

    beforeEach(() => { h = new Harness() })
    afterEach(() => h.Dispose())

    it('discovers the tenants of an email', async () =>
    {
        expect(await h.Service.Discover(Harness.Platform, ' ada@acme.example ')).toEqual([{ Id: 't1', DisplayName: 'Acme' }])
        const [discover] = h.Fetch.To('/api/desktop/discover')
        expect(discover.Url).toBe('http://localhost:7000/api/desktop/discover')
        expect(discover.Method).toBe('POST')
        expect(discover.Body).toEqual({ email: 'ada@acme.example' })
        expect(discover.Headers['origin']).toBeUndefined()
    })

    it('discovered tenants reach the renderer without their console address', async () =>
    {
        h.Fetch.Routes.set('/api/desktop/discover', () => FakeFetch.Json(200, {
            tenants: [{ id: 't1', displayName: 'Acme', consoleUrl: 'https://console-t1.example' }, { id: 't2', displayName: 'Beta' }],
            tenantPlaneUrl: Harness.Plane,
        }))
        const found = await h.Service.Discover(Harness.Platform, 'ada@acme.example')
        expect(found).toEqual([{ Id: 't1', DisplayName: 'Acme' }, { Id: 't2', DisplayName: 'Beta' }])
        for (const tenant of found)
        {
            expect(Object.keys(tenant).sort()).toEqual(['DisplayName', 'Id'])
        }
        expect(JSON.stringify(found)).not.toContain('console-t1')
    })

    it('maps an unknown email to NoAccount and a dead platform to Unreachable', async () =>
    {
        h.Fetch.Routes.set('/api/desktop/discover', () => FakeFetch.Json(404, { error: 'no-account' }))
        expect(await Caught.Kind(h.Service.Discover(Harness.Platform, 'x@y.z'))).toBe(AccountErrorKind.NoAccount)
        h.Fetch.Routes.delete('/api/desktop/discover')
        expect(await Caught.Kind(h.Service.Discover(Harness.Platform, 'x@y.z'))).toBe(AccountErrorKind.Unreachable)
        h.Fetch.Routes.set('/api/desktop/discover', () => FakeFetch.Json(503, { error: 'unavailable' }))
        expect(await Caught.Kind(h.Service.Discover(Harness.Platform, 'x@y.z'))).toBe(AccountErrorKind.Unavailable)
    })

    it('maps a malformed email (400) to InvalidEmail', async () =>
    {
        h.Fetch.Routes.set('/api/desktop/discover', () => FakeFetch.Json(400, { error: 'invalid-email' }))
        expect(await Caught.Kind(h.Service.Discover(Harness.Platform, 'nope'))).toBe(AccountErrorKind.InvalidEmail)
    })

    it('refuses a cleartext non-loopback Platform address without dialing it', async () =>
    {
        expect(await Caught.Kind(h.Service.Discover('http://p.example', 'x@y.z'))).toBe(AccountErrorKind.Unreachable)
        expect(h.Fetch.Requests).toEqual([])
    })

    it('signs in through the browser, saves the session and reports state without a token', async () =>
    {
        await h.Service.Discover(Harness.Platform, 'ada@acme.example')
        const state = await h.SignIn()
        expect(state).toEqual({ SignedIn: true, Email: 'ada@acme.example', TenantName: 'Acme' })
        expect(await h.Service.State()).toEqual(state)
        expect(JSON.stringify(await h.Service.State())).not.toContain('secret-token')
        expect(Object.keys(await h.Service.State())).not.toContain('Token')
        expect(h.Opened).toEqual([Harness.Authorize])
        expect(h.Receiver.ExpectedState).toBe('st-123')
        expect(h.Receiver.Closed).toBe(1)
        expect(h.Changes).toEqual([state])
        expect(await h.Store.Load()).toEqual({
            ConsoleUrl: Harness.Plane, Token: 'secret-token-t1', Email: 'ada@acme.example', TenantId: 't1', TenantName: 'Acme', ExpiresAt: '2026-11-11T00:00:00.000Z',
        })
        expect(await h.Service.Session()).toEqual(await h.Store.Load())
    })

    it('binds the sign-in: the challenge is base64url(sha256(verifier)) and the verifier goes only to Complete', async () =>
    {
        await h.SignIn()
        const [begin] = h.Fetch.To('/desktop/sign-in/begin')
        const [complete] = h.Fetch.To('/desktop/sign-in/complete')
        expect(begin.Url).toBe('http://127.0.0.1:7002/desktop/sign-in/begin')
        expect(begin.Body).toMatchObject({ tenantId: 't1', redirectUri: FakeReceiver.Uri })
        const verifier = complete.Body!['bindingVerifier'] as string
        const challenge = begin.Body!['bindingChallenge'] as string
        expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
        expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
        expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
        expect(complete.Body).toEqual({ state: 'st-123', code: 'the-code', bindingVerifier: verifier })
        const elsewhere = h.Fetch.Requests.filter(r => r !== complete).map(r => JSON.stringify(r))
        for (const request of elsewhere)
        {
            expect(request).not.toContain(verifier)
        }
        expect(h.Opened.join()).not.toContain(verifier)
    })

    it('uses a fresh verifier per sign-in', async () =>
    {
        await h.SignIn()
        await h.SignIn()
        const verifiers = h.Fetch.To('/desktop/sign-in/complete').map(r => r.Body!['bindingVerifier'])
        expect(verifiers[0]).not.toBe(verifiers[1])
    })

    it('fails a timed-out sign-in, closes the receiver and stays signed out', async () =>
    {
        h.Receiver.Outcome = async () => { throw new AccountError(AccountErrorKind.TimedOut) }
        expect(await Caught.Kind(h.SignIn())).toBe(AccountErrorKind.TimedOut)
        expect(h.Receiver.Closed).toBe(1)
        expect(await h.Service.State()).toEqual({ SignedIn: false })
        expect(h.Fetch.To('/desktop/sign-in/complete')).toEqual([])
    })

    it('CancelSignIn cancels the browser wait', async () =>
    {
        h.Receiver.Outcome = () => new Promise<string>(() => undefined)
        const signIn = Caught.Kind(h.SignIn())
        while (h.Receiver.ExpectedState === undefined) await new Promise(r => setTimeout(r, 1))
        await h.Service.CancelSignIn()
        expect(await signIn).toBe(AccountErrorKind.Cancelled)
        expect(h.Receiver.Cancelled).toBe(true)
        expect(h.Receiver.Closed).toBe(1)
    })

    it('cancel during discovery: no browser, no Begin, kind Cancelled', async () =>
    {
        const gate = new Gate()
        h.Fetch.Routes.set('/api/desktop/discover', async () =>
        {
            await gate.Opened
            return FakeFetch.Json(200, { tenants: [{ id: 't1', displayName: 'Acme' }], tenantPlaneUrl: Harness.Plane })
        })
        const signIn = Caught.Kind(h.SignIn())
        while (h.Fetch.To('/api/desktop/discover').length === 0) await new Promise(r => setTimeout(r, 1))
        await h.Service.CancelSignIn()
        gate.Release()
        expect(await signIn).toBe(AccountErrorKind.Cancelled)
        expect(h.Opened).toEqual([])
        expect(h.Fetch.To('/desktop/sign-in/begin')).toEqual([])
        expect(h.Receiver.Closed).toBe(1)
    })

    it('signs in at the chosen tenant\'s console address', async () =>
    {
        h.Fetch.Routes.set('/api/desktop/discover', () => FakeFetch.Json(200, {
            tenants: [{ id: 'a', displayName: 'A', consoleUrl: 'https://console-a.example' }, { id: 'b', displayName: 'B', consoleUrl: 'http://127.0.0.1:7002' }],
            tenantPlaneUrl: Harness.Plane,
        }))
        h.Fetch.Routes.set('/desktop/sign-in/complete', () => FakeFetch.Json(200, { token: 'tok-a', expiresAt: '2026-11-11T00:00:00.000Z', tenantId: 'a', tenantName: 'A' }))
        h.Fetch.Routes.set('/desktop/targets', () => FakeFetch.Json(200, { contribute: [], publish: [] }))
        await h.Service.SignIn(Harness.Platform, 'ada@acme.example', 'a')
        expect(h.Fetch.To('/desktop/sign-in/begin')[0].Url).toBe('https://console-a.example/desktop/sign-in/begin')
        expect(h.Fetch.To('/desktop/sign-in/complete')[0].Url).toBe('https://console-a.example/desktop/sign-in/complete')
        expect((await h.Store.Load())!.ConsoleUrl).toBe('https://console-a.example')
        await h.Service.Targets()
        expect(h.Fetch.To('/desktop/targets')[0].Url).toBe('https://console-a.example/desktop/targets')
    })

    it('a discovered cleartext non-loopback console is refused before Begin', async () =>
    {
        h.Fetch.Routes.set('/api/desktop/discover', () => FakeFetch.Json(200, {
            tenants: [{ id: 'a', displayName: 'A', consoleUrl: 'http://console-a.example' }],
            tenantPlaneUrl: Harness.Plane,
        }))
        expect(await Caught.Kind(h.Service.SignIn(Harness.Platform, 'ada@acme.example', 'a'))).toBe(AccountErrorKind.Unavailable)
        expect(h.Fetch.To('/desktop/sign-in/begin')).toEqual([])
        expect(h.Opened).toEqual([])
        expect(h.Receiver.Started).toBe(0)
        expect(h.Fetch.Requests.filter(r => !r.Url.includes('/api/desktop/discover'))).toEqual([])
    })

    it('a tenant absent from the discovery answer is NoAccount', async () =>
    {
        expect(await Caught.Kind(h.Service.SignIn(Harness.Platform, 'ada@acme.example', 'nope'))).toBe(AccountErrorKind.NoAccount)
        expect(h.Fetch.To('/desktop/sign-in/begin')).toEqual([])
    })

    it('SignInAtConsole signs in at the typed address', async () =>
    {
        h.Fetch.Routes.set('/desktop/console', () => FakeFetch.Json(200, { tenantId: 'acme', tenantName: 'Acme' }))
        h.Fetch.Routes.set('/desktop/sign-in/complete', () => FakeFetch.Json(200, { token: 'tok-acme', expiresAt: '2026-11-11T00:00:00.000Z', tenantId: 'acme', tenantName: 'Acme' }))
        const state = await h.Service.SignInAtConsole('  HTTPS://Console-Acme.localtest.me/ ', 'ada@acme.example')
        expect(state).toEqual({ SignedIn: true, Email: 'ada@acme.example', TenantName: 'Acme' })
        expect(h.Fetch.To('/desktop/console')[0].Url).toBe('https://console-acme.localtest.me/desktop/console')
        const [begin] = h.Fetch.To('/desktop/sign-in/begin')
        expect(begin.Url).toBe('https://console-acme.localtest.me/desktop/sign-in/begin')
        expect(begin.Body).toMatchObject({ tenantId: 'acme' })
        expect(begin.Body).not.toHaveProperty('email')
        expect((await h.Store.Load())!.ConsoleUrl).toBe('https://console-acme.localtest.me')
        expect(h.Fetch.To('/api/desktop/discover')).toEqual([])
    })

    it('SignInAtConsole rejects an invalid address without dialing', async () =>
    {
        expect(await Caught.Kind(h.Service.SignInAtConsole('http://console-acme.localtest.me', 'a@b.c'))).toBe(AccountErrorKind.ConsoleAddressInvalid)
        expect(h.Fetch.Requests).toEqual([])
        expect(h.Opened).toEqual([])
        expect(h.Receiver.Started).toBe(0)
    })

    it('SignInAtConsole on a non-console never opens the browser', async () =>
    {
        h.Fetch.Routes.set('/desktop/console', () => FakeFetch.Json(404, {}))
        expect(await Caught.Kind(h.Service.SignInAtConsole('https://console-acme.localtest.me', 'a@b.c'))).toBe(AccountErrorKind.NotAConsole)
        expect(h.Fetch.To('/desktop/sign-in/begin')).toEqual([])
        expect(h.Opened).toEqual([])
        expect(h.Receiver.Started).toBe(0)
        expect(h.Receiver.Closed).toBe(1)
    })

    it('cancel during the console lookup: no browser, kind Cancelled', async () =>
    {
        const gate = new Gate()
        h.Fetch.Routes.set('/desktop/console', async () =>
        {
            await gate.Opened
            return FakeFetch.Json(200, { tenantId: 'acme', tenantName: 'Acme' })
        })
        const signIn = Caught.Kind(h.Service.SignInAtConsole('https://console-acme.localtest.me', 'a@b.c'))
        while (h.Fetch.To('/desktop/console').length === 0) await new Promise(r => setTimeout(r, 1))
        await h.Service.CancelSignIn()
        gate.Release()
        expect(await signIn).toBe(AccountErrorKind.Cancelled)
        expect(h.Opened).toEqual([])
        expect(h.Fetch.To('/desktop/sign-in/begin')).toEqual([])
        expect(h.Receiver.Started).toBe(0)
        expect(h.Receiver.Closed).toBe(1)
    })

    it('signing in to a console ends the previous platform session at the platform', async () =>
    {
        writeFileSync(join(h.Dir, 'desktop-session.bin'), h.Encryptor.Encrypt(JSON.stringify({
            TenantPlaneUrl: Harness.Plane, Token: 'old-token', Email: 'ada@acme.example', TenantId: 't0', TenantName: 'Old', ExpiresAt: '2026-11-11T00:00:00.000Z',
        })))
        h.Fetch.Routes.set('/desktop/console', () => FakeFetch.Json(200, { tenantId: 'acme', tenantName: 'Acme' }))
        h.Fetch.Routes.set('/desktop/sign-out', () => new Response(null, { status: 204 }))
        h.Fetch.Routes.set('/desktop/sign-in/complete', () => FakeFetch.Json(200, { token: 'tok-acme', expiresAt: '2026-11-11T00:00:00.000Z', tenantId: 'acme', tenantName: 'Acme' }))
        await h.Service.SignInAtConsole('https://console-acme.localtest.me', 'ada@acme.example')
        const [signOut] = h.Fetch.To('/desktop/sign-out')
        expect(signOut.Url).toBe('http://127.0.0.1:7002/desktop/sign-out')
        expect(signOut.Headers['authorization']).toBe('Bearer old-token')
    })

    it('cancel during an in-flight Begin (also the will-quit path): no browser, kind Cancelled', async () =>
    {
        const gate = new Gate()
        h.Fetch.Routes.set('/desktop/sign-in/begin', async () =>
        {
            await gate.Opened
            return FakeFetch.Json(200, { authorizeUrl: Harness.Authorize })
        })
        const signIn = Caught.Kind(h.SignIn())
        while (h.Fetch.To('/desktop/sign-in/begin').length === 0) await new Promise(r => setTimeout(r, 1))
        await h.Service.CancelSignIn()
        gate.Release()
        expect(await signIn).toBe(AccountErrorKind.Cancelled)
        expect(h.Opened).toEqual([])
        expect(h.Receiver.ExpectedState).toBeUndefined()
        expect(h.Receiver.Closed).toBe(1)
        expect(await h.Service.State()).toEqual({ SignedIn: false })
    })

    it('cancel reports Cancelled even when the in-flight step then fails', async () =>
    {
        const gate = new Gate()
        h.Fetch.Routes.set('/desktop/sign-in/begin', async () =>
        {
            await gate.Opened
            return FakeFetch.Json(503, { error: 'unavailable' })
        })
        const signIn = Caught.Kind(h.SignIn())
        while (h.Fetch.To('/desktop/sign-in/begin').length === 0) await new Promise(r => setTimeout(r, 1))
        await h.Service.CancelSignIn()
        gate.Release()
        expect(await signIn).toBe(AccountErrorKind.Cancelled)
    })

    it('cancel during an in-flight Complete that then succeeds ends the fresh session and reports Cancelled', async () =>
    {
        const gate = new Gate()
        h.Fetch.Routes.set('/desktop/sign-in/complete', async () =>
        {
            await gate.Opened
            return FakeFetch.Json(200, { token: 'secret-token-late', expiresAt: '2026-11-11T00:00:00.000Z', tenantId: 't1', tenantName: 'Acme', email: 'ada@acme.example' })
        })
        h.Fetch.Routes.set('/desktop/sign-out', () => new Response(null, { status: 204 }))
        const signIn = Caught.Kind(h.SignIn())
        while (h.Fetch.To('/desktop/sign-in/complete').length === 0) await new Promise(r => setTimeout(r, 1))
        await h.Service.CancelSignIn()
        gate.Release()
        expect(await signIn).toBe(AccountErrorKind.Cancelled)
        const signOuts = h.Fetch.To('/desktop/sign-out')
        expect(signOuts).toHaveLength(1)
        expect(signOuts[0].Url).toBe('http://127.0.0.1:7002/desktop/sign-out')
        expect(signOuts[0].Headers['authorization']).toBe('Bearer secret-token-late')
        expect(await h.Store.Load()).toBeUndefined()
        expect(h.Changes).toEqual([])
    })

    it('treats a complete answer missing tenant fields as SignInFailed', async () =>
    {
        h.Fetch.Routes.set('/desktop/sign-in/complete', () => FakeFetch.Json(200, { token: 'secret-token-x', expiresAt: '2026-11-11T00:00:00.000Z', tenantId: 't1', tenantName: '' }))
        expect(await Caught.Kind(h.SignIn())).toBe(AccountErrorKind.SignInFailed)
        h.Fetch.Routes.set('/desktop/sign-in/complete', () => FakeFetch.Json(200, { token: 'secret-token-x', expiresAt: '', tenantId: 't1', tenantName: 'Acme' }))
        expect(await Caught.Kind(h.SignIn())).toBe(AccountErrorKind.SignInFailed)
        h.Fetch.Routes.set('/desktop/sign-in/complete', () => FakeFetch.Json(200, { token: 'secret-token-x', expiresAt: '2026-11-11T00:00:00.000Z', tenantId: '', tenantName: 'Acme' }))
        expect(await Caught.Kind(h.SignIn())).toBe(AccountErrorKind.SignInFailed)
        expect(await h.Service.State()).toEqual({ SignedIn: false })
    })

    it('maps a refused complete to SignInFailed', async () =>
    {
        h.Fetch.Routes.set('/desktop/sign-in/complete', () => FakeFetch.Json(401, { error: 'sign-in-failed' }))
        expect(await Caught.Kind(h.SignIn())).toBe(AccountErrorKind.SignInFailed)
        expect(await h.Service.State()).toEqual({ SignedIn: false })
    })

    it('refuses an authorize URL that is not http(s) and never opens it', async () =>
    {
        h.Fetch.Routes.set('/desktop/sign-in/begin', () => FakeFetch.Json(200, { authorizeUrl: 'file:///C:/evil.exe?state=s' }))
        expect(await Caught.Kind(h.SignIn())).toBe(AccountErrorKind.SignInFailed)
        expect(h.Opened).toEqual([])
    })

    it('lists targets with the bearer and maps the statuses', async () =>
    {
        await h.SignIn()
        h.Fetch.Routes.set('/desktop/targets', () => FakeFetch.Json(200, {
            contribute: [{ name: 'dev', status: 'running' }],
            publish: [{ name: 'prod', status: 'stopped' }, { name: 'odd', status: 'weird' }],
        }))
        expect(await h.Service.Targets()).toEqual({
            Contribute: [{ Name: 'dev', Status: TargetStatus.Running }],
            Publish: [{ Name: 'prod', Status: TargetStatus.Stopped }, { Name: 'odd', Status: TargetStatus.Unknown }],
        })
        const [targets] = h.Fetch.To('/desktop/targets')
        expect(targets.Url).toBe('http://127.0.0.1:7002/desktop/targets')
        expect(targets.Headers['authorization']).toBe('Bearer secret-token-t1')
    })

    it('Targets 401 -> SignedOut, store cleared, Changed emitted signed out', async () =>
    {
        await h.SignIn()
        h.Fetch.Routes.set('/desktop/targets', () => FakeFetch.Json(401, { error: 'signed-out' }))
        expect(await Caught.Kind(h.Service.Targets())).toBe(AccountErrorKind.SignedOut)
        expect(await h.Store.Load()).toBeUndefined()
        expect(h.Changes.at(-1)).toEqual({ SignedIn: false })
        expect(await h.Service.State()).toEqual({ SignedIn: false })
    })

    it('Targets without a session is SignedOut without dialing', async () =>
    {
        expect(await Caught.Kind(h.Service.Targets())).toBe(AccountErrorKind.SignedOut)
        expect(h.Fetch.Requests).toEqual([])
    })

    it('SignOut ends the session on the server and clears', async () =>
    {
        await h.SignIn()
        h.Fetch.Routes.set('/desktop/sign-out', () => new Response(null, { status: 204 }))
        expect(await h.Service.SignOut()).toEqual({ SignedIn: false })
        const [signOut] = h.Fetch.To('/desktop/sign-out')
        expect(signOut.Method).toBe('POST')
        expect(signOut.Headers['authorization']).toBe('Bearer secret-token-t1')
        expect(await h.Store.Load()).toBeUndefined()
        expect(h.Changes.at(-1)).toEqual({ SignedIn: false })
    })

    it('SignOut clears even when the server is unreachable', async () =>
    {
        await h.SignIn()
        expect(await h.Service.SignOut()).toEqual({ SignedIn: false })
        expect(h.Fetch.To('/desktop/sign-out')).toHaveLength(1)
        expect(await h.Store.Load()).toBeUndefined()
        expect(h.Changes.at(-1)).toEqual({ SignedIn: false })
    })

    it('HandleSignedOut for the stored token clears the store and emits Changed', async () =>
    {
        await h.SignIn()
        await h.Service.HandleSignedOut('secret-token-t1')
        expect(await h.Service.Session()).toBeUndefined()
        expect(h.Changes.at(-1)).toEqual({ SignedIn: false })
    })

    it('HandleSignedOut for a session already replaced leaves the newer one alone', async () =>
    {
        await h.SignIn()
        const changes = h.Changes.length
        await h.Service.HandleSignedOut('secret-token-old')
        expect((await h.Service.Session())?.Token).toBe('secret-token-t1')
        expect(h.Changes).toHaveLength(changes)
    })

    it('a Targets 401 that lands after a new sign-in does not sign the new session out', async () =>
    {
        await h.SignIn()
        const gate = new Gate()
        h.Fetch.Routes.set('/desktop/targets', async () =>
        {
            await gate.Opened
            return FakeFetch.Json(401, { error: 'signed-out' })
        })
        const targets = Caught.Kind(h.Service.Targets())
        while (h.Fetch.To('/desktop/targets').length === 0) await new Promise(r => setTimeout(r, 1))
        h.Fetch.Routes.set('/desktop/sign-out', () => new Response(null, { status: 204 }))
        h.Tenant('t2', 'Globex', 'ada@acme.example')
        await h.SignIn('t2')
        gate.Release()
        expect(await targets).toBe(AccountErrorKind.SignedOut)
        expect((await h.Service.Session())?.Token).toBe('secret-token-t2')
        expect(h.Changes.at(-1)).toEqual({ SignedIn: true, Email: 'ada@acme.example', TenantName: 'Globex' })
    })

    it('a stale 401 already clearing cannot remove the session a concurrent sign-in saves (writes are serialised)', async () =>
    {
        await h.SignIn()
        const targetsGate = new Gate()
        h.Fetch.Routes.set('/desktop/targets', async () =>
        {
            await targetsGate.Opened
            return FakeFetch.Json(401, { error: 'signed-out' })
        })
        const targets = Caught.Kind(h.Service.Targets())
        while (h.Fetch.To('/desktop/targets').length === 0) await new Promise(r => setTimeout(r, 1))
        // Hold the 401's Clear after it has loaded and matched the old session.
        const clearEntered = new Gate()
        const clearGate = new Gate()
        const clear = h.Store.Clear.bind(h.Store)
        h.Store.Clear = async () =>
        {
            clearEntered.Release()
            await clearGate.Opened
            await clear()
        }
        targetsGate.Release()
        await clearEntered.Opened
        h.Tenant('t2', 'Globex', 'ada@acme.example')
        const signIn = h.SignIn('t2')
        // Give the sign-in every chance to reach its Save while the clear is held.
        while (h.Fetch.To('/desktop/sign-in/complete').length < 2) await new Promise(r => setTimeout(r, 1))
        for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 1))
        clearGate.Release()
        expect(await targets).toBe(AccountErrorKind.SignedOut)
        expect(await signIn).toEqual({ SignedIn: true, Email: 'ada@acme.example', TenantName: 'Globex' })
        expect((await h.Service.Session())?.Token).toBe('secret-token-t2')
        expect(h.Changes.at(-1)).toEqual({ SignedIn: true, Email: 'ada@acme.example', TenantName: 'Globex' })
    })

    it('without secure storage, sign-in fails SecureStorageUnavailable before discovery or the browser', async () =>
    {
        h.Encryptor.Available = false
        expect(await Caught.Kind(h.SignIn())).toBe(AccountErrorKind.SecureStorageUnavailable)
        expect(h.Opened).toEqual([])
        expect(h.Fetch.Requests).toEqual([])
        expect(h.Receiver.Closed).toBe(0)
        expect(h.Changes).toEqual([])
    })

    it('a session that cannot be stored after Complete is ended on the tenant plane before the failure is reported', async () =>
    {
        h.Fetch.Routes.set('/desktop/sign-in/complete', () =>
        {
            // The keyring goes away while the browser step runs.
            h.Encryptor.Available = false
            return FakeFetch.Json(200, { token: 'secret-token-issued', expiresAt: '2026-11-11T00:00:00.000Z', tenantId: 't1', tenantName: 'Acme', email: 'ada@acme.example' })
        })
        h.Fetch.Routes.set('/desktop/sign-out', () => new Response(null, { status: 204 }))
        expect(await Caught.Kind(h.SignIn())).toBe(AccountErrorKind.SecureStorageUnavailable)
        const signOuts = h.Fetch.To('/desktop/sign-out')
        expect(signOuts).toHaveLength(1)
        expect(signOuts[0].Headers['authorization']).toBe('Bearer secret-token-issued')
        expect(h.Changes).toEqual([])
        expect(h.Receiver.Closed).toBe(1)
    })

    it('RememberChoice / LastChoice round-trip per kind and are keyed by tenant', async () =>
    {
        await h.SignIn()
        expect(await h.Service.LastChoice(TargetKind.Publish)).toBeUndefined()
        await h.Service.RememberChoice(TargetKind.Publish, { Environment: 'prod' })
        await h.Service.RememberChoice(TargetKind.Contribute, { Environment: 'dev', GraphName: 'main' })
        expect(await h.Service.LastChoice(TargetKind.Publish)).toEqual({ Environment: 'prod' })
        expect(await h.Service.LastChoice(TargetKind.Contribute)).toEqual({ Environment: 'dev', GraphName: 'main' })

        h.Tenant('t2', 'Globex', 'ada@globex.example')
        await h.SignIn('t2', 'ada@globex.example')
        expect(await h.Service.LastChoice(TargetKind.Publish)).toBeUndefined()
        await h.Service.RememberChoice(TargetKind.Publish, { Environment: 'g-prod' })

        h.Tenant('t1', 'Acme', 'ada@acme.example')
        await h.SignIn()
        expect(await h.Service.LastChoice(TargetKind.Publish)).toEqual({ Environment: 'prod' })

        const file = readFileSync(join(h.Dir, 'publish-choices.json'), 'utf8')
        expect(file).not.toContain('secret-token')
        expect(JSON.parse(file)).toEqual({
            t1: { contribute: { Environment: 'dev', GraphName: 'main' }, publish: { Environment: 'prod' } },
            t2: { publish: { Environment: 'g-prod' } },
        })
    })

    it('concurrent RememberChoice calls both land', async () =>
    {
        await h.SignIn()
        await Promise.all([
            h.Service.RememberChoice(TargetKind.Publish, { Environment: 'prod' }),
            h.Service.RememberChoice(TargetKind.Contribute, { Environment: 'dev', GraphName: 'g' }),
            h.Service.RememberChoice(TargetKind.Publish, { Environment: 'prod-2' }),
        ])
        expect(await h.Service.LastChoice(TargetKind.Publish)).toEqual({ Environment: 'prod-2' })
        expect(await h.Service.LastChoice(TargetKind.Contribute)).toEqual({ Environment: 'dev', GraphName: 'g' })
    })

    it('LastChoice is undefined and RememberChoice is SignedOut when signed out', async () =>
    {
        expect(await h.Service.LastChoice(TargetKind.Publish)).toBeUndefined()
        expect(await Caught.Kind(h.Service.RememberChoice(TargetKind.Publish, { Environment: 'p' }))).toBe(AccountErrorKind.SignedOut)
    })
})
