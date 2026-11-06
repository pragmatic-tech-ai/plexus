import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountError, AccountErrorKind, PlatformAccess, TargetKind, TargetSource, TargetStatus, type AccountState } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { AccountService } from '../account-service.js'
import { DesktopApiClient } from '../desktop-api-client.js'
import { DesktopSessionStore } from '../desktop-session-store.js'
import type { IRedirectReceiver } from '../loopback-redirect-receiver.js'
import { ReverseEncryptor } from './reverse-encryptor.js'

type Recorded = { Url: string; Method: string; Headers: Record<string, string>; Body: Record<string, unknown> | undefined }
type Route = () => Response | Promise<Response>

// A fetch double keyed by path, or by origin + path when one address needs its own answer (a
// console and the tenant plane share every /desktop/ path). A route that is missing answers a
// network failure, like an unreachable host.
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
        const parsed = new URL(url)
        const route = this.Routes.get(`${parsed.origin}${parsed.pathname}`) ?? this.Routes.get(parsed.pathname)
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

    public At(url: string): Recorded[]
    {
        return this.Requests.filter(r => r.Url === url)
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
    public static readonly Console = 'https://console-t1.example'
    public static readonly Authorize = 'https://idp.example/realms/t/authorize?client_id=plexus&state=st-123&code_challenge=x'
    public readonly Dir = mkdtempSync(join(tmpdir(), 'account-service-'))
    public readonly Fetch = new FakeFetch()
    public readonly Receiver = new FakeReceiver()
    public readonly Opened: string[] = []
    public readonly Changes: AccountState[] = []
    public readonly Encryptor = new ReverseEncryptor()
    public readonly Store = new DesktopSessionStore(this.Dir, this.Encryptor)
    public readonly Service: AccountService
    // The clock the service reads; every issued session expires at 2026-11-11.
    public Now = Date.parse('2026-11-08T00:00:00.000Z')
    public Saves = 0

    public constructor()
    {
        this.Service = new AccountService(
            this.Store, this.Dir, new DesktopApiClient(this.Fetch.Fetch as typeof fetch), () => this.Receiver, async url => { this.Opened.push(url) }, () => this.Now,
        )
        this.Service.Changed.subscribe(s => this.Changes.push(s))
        this.Tenant('t1', 'Acme', 'ada@acme.example')
        const save = this.Store.Save.bind(this.Store)
        this.Store.Save = async account => { this.Saves++; await save(account) }
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

    // An in-hive tenant: discovery names its own console and, when `platformEnvironments`, says the
    // platform also holds environments of it. The console and the tenant plane each issue their own
    // token for the tenant; both answer sign-out, and each lists its own targets.
    public InHive(platformEnvironments = true, id = 't1', name = 'Acme', email = 'ada@acme.example'): void
    {
        this.Fetch.Routes.set('/api/desktop/discover', () => FakeFetch.Json(200, {
            tenants: [{ id, displayName: name, consoleUrl: Harness.Console, platformEnvironments }],
            tenantPlaneUrl: `${Harness.Plane}/`,
        }))
        this.Fetch.Routes.set(`${Harness.Console}/desktop/sign-in/complete`, () => FakeFetch.Json(200, {
            token: `secret-console-${id}`, expiresAt: '2026-11-11T00:00:00.000Z', tenantId: id, tenantName: name, email,
        }))
        this.PlatformIssues(id, `secret-platform-${id}`, email)
        this.Fetch.Routes.set('/desktop/sign-out', () => new Response(null, { status: 204 }))
        this.Fetch.Routes.set(`${Harness.Console}/desktop/targets`, () => FakeFetch.Json(200, {
            contribute: [{ name: 'dev', status: 'running' }], publish: [{ name: 'prod', status: 'stopped' }],
        }))
        this.Fetch.Routes.set(`${Harness.Plane}/desktop/targets`, () => FakeFetch.Json(200, {
            contribute: [{ name: 'dev', status: 'stopped' }], publish: [{ name: 'p-prod', status: 'running' }],
        }))
    }

    public PlatformIssues(tenantId: string, token: string, email = 'ada@acme.example'): void
    {
        this.Fetch.Routes.set(`${Harness.Plane}/desktop/sign-in/complete`, () => FakeFetch.Json(200, {
            token, expiresAt: '2026-11-11T00:00:00.000Z', tenantId, tenantName: 'Acme (platform)', email,
        }))
    }

    // Signs in at the in-hive console, then at the platform.
    public async SignInBoth(): Promise<AccountState>
    {
        this.InHive()
        await this.SignIn()
        return this.Service.SignInAtPlatform()
    }

    public SignOutsWith(token: string): Recorded[]
    {
        return this.Fetch.To('/desktop/sign-out').filter(r => r.Headers['authorization'] === `Bearer ${token}`)
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
        expect((await h.Store.Load()).Console).toEqual({
            ConsoleUrl: Harness.Plane, Token: 'secret-token-t1', Email: 'ada@acme.example', TenantId: 't1', TenantName: 'Acme', ExpiresAt: '2026-11-11T00:00:00.000Z',
        })
        const stored = (await h.Store.Load()).Console!
        expect(await h.Service.SessionFor(TargetSource.Console)).toEqual({ ConsoleUrl: stored.ConsoleUrl, Token: stored.Token })
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
        expect((await h.Store.Load()).Console!.ConsoleUrl).toBe('https://console-a.example')
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

    it('a discovered console address with a path is refused before Begin', async () =>
    {
        h.Fetch.Routes.set('/api/desktop/discover', () => FakeFetch.Json(200, {
            tenants: [{ id: 'a', displayName: 'A', consoleUrl: 'https://console-a.example/base' }],
            tenantPlaneUrl: Harness.Plane,
        }))
        expect(await Caught.Kind(h.Service.SignIn(Harness.Platform, 'ada@acme.example', 'a'))).toBe(AccountErrorKind.Unavailable)
        expect(h.Opened).toEqual([])
        expect(h.Receiver.Started).toBe(0)
        expect(h.Fetch.Requests.filter(r => !r.Url.includes('/api/desktop/discover'))).toEqual([])
    })

    it('SignInAtConsole refuses a typed address with a path without dialing', async () =>
    {
        expect(await Caught.Kind(h.Service.SignInAtConsole('https://console-acme.localtest.me/base', 'a@b.c'))).toBe(AccountErrorKind.ConsoleAddressInvalid)
        expect(h.Fetch.Requests).toEqual([])
        expect(h.Opened).toEqual([])
        expect(h.Receiver.Started).toBe(0)
    })

    it('a tenant without its own console signs in at the platform tenant plane, base path kept', async () =>
    {
        const plane = 'https://platform.example/tenant-plane'
        h.Fetch.Routes.set('/api/desktop/discover', () => FakeFetch.Json(200, { tenants: [{ id: 't1', displayName: 'Acme' }], tenantPlaneUrl: plane }))
        h.Fetch.Routes.set('/tenant-plane/desktop/sign-in/begin', () => FakeFetch.Json(200, { authorizeUrl: Harness.Authorize }))
        h.Fetch.Routes.set('/tenant-plane/desktop/sign-in/complete', () => FakeFetch.Json(200, { token: 'tok-t1', expiresAt: '2026-11-11T00:00:00.000Z', tenantId: 't1', tenantName: 'Acme' }))
        expect(await h.SignIn()).toEqual({ SignedIn: true, Email: 'ada@acme.example', TenantName: 'Acme' })
        expect(h.Fetch.To('/tenant-plane/desktop/sign-in/begin')[0].Url).toBe('https://platform.example/tenant-plane/desktop/sign-in/begin')
        expect(h.Fetch.To('/tenant-plane/desktop/sign-in/complete')[0].Url).toBe('https://platform.example/tenant-plane/desktop/sign-in/complete')
        expect((await h.Store.Load()).Console!.ConsoleUrl).toBe(plane)
    })

    it('a cleartext non-loopback tenant plane fallback is refused before Begin', async () =>
    {
        h.Fetch.Routes.set('/api/desktop/discover', () => FakeFetch.Json(200, { tenants: [{ id: 't1', displayName: 'Acme' }], tenantPlaneUrl: 'http://platform.example/tenant-plane' }))
        expect(await Caught.Kind(h.SignIn())).toBe(AccountErrorKind.Unavailable)
        expect(h.Fetch.Requests.filter(r => !r.Url.includes('/api/desktop/discover'))).toEqual([])
        expect(h.Opened).toEqual([])
        expect(h.Receiver.Started).toBe(0)
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
        expect((await h.Store.Load()).Console!.ConsoleUrl).toBe('https://console-acme.localtest.me')
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
        expect((await h.Store.Load()).Console).toBeUndefined()
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
            Contribute: [{ Id: 'console:dev', Name: 'dev', Status: TargetStatus.Running, Source: TargetSource.Console }],
            Publish: [
                { Id: 'console:prod', Name: 'prod', Status: TargetStatus.Stopped, Source: TargetSource.Console },
                { Id: 'console:odd', Name: 'odd', Status: TargetStatus.Unknown, Source: TargetSource.Console },
            ],
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
        expect((await h.Store.Load()).Console).toBeUndefined()
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
        expect((await h.Store.Load()).Console).toBeUndefined()
        expect(h.Changes.at(-1)).toEqual({ SignedIn: false })
    })

    it('SignOut clears even when the server is unreachable', async () =>
    {
        await h.SignIn()
        expect(await h.Service.SignOut()).toEqual({ SignedIn: false })
        expect(h.Fetch.To('/desktop/sign-out')).toHaveLength(1)
        expect((await h.Store.Load()).Console).toBeUndefined()
        expect(h.Changes.at(-1)).toEqual({ SignedIn: false })
    })

    it('HandleSignedOut for the stored token clears the store and emits Changed', async () =>
    {
        await h.SignIn()
        await h.Service.HandleSignedOut('secret-token-t1')
        expect(await h.Service.SessionFor(TargetSource.Console)).toBeUndefined()
        expect(h.Changes.at(-1)).toEqual({ SignedIn: false })
    })

    it('HandleSignedOut for a session already replaced leaves the newer one alone', async () =>
    {
        await h.SignIn()
        const changes = h.Changes.length
        await h.Service.HandleSignedOut('secret-token-old')
        expect((await h.Service.SessionFor(TargetSource.Console))?.Token).toBe('secret-token-t1')
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
        expect((await h.Service.SessionFor(TargetSource.Console))?.Token).toBe('secret-token-t2')
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
        expect((await h.Service.SessionFor(TargetSource.Console))?.Token).toBe('secret-token-t2')
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

describe('AccountService platform session', () =>
{
    const ConsoleToken = 'secret-console-t1'
    const PlatformToken = 'secret-platform-t1'
    const Offered: AccountState = { SignedIn: true, Email: 'ada@acme.example', TenantName: 'Acme', Platform: PlatformAccess.Offered }
    const BothIn: AccountState = { SignedIn: true, Email: 'ada@acme.example', TenantName: 'Acme', Platform: PlatformAccess.SignedIn }
    const ConsoleSet = {
        Contribute: [{ Id: 'console:dev', Name: 'dev', Status: TargetStatus.Running, Source: TargetSource.Console }],
        Publish: [{ Id: 'console:prod', Name: 'prod', Status: TargetStatus.Stopped, Source: TargetSource.Console }],
    }
    let h: Harness

    beforeEach(() => { h = new Harness() })
    afterEach(() => h.Dispose())

    it('a discovery sign-in for a tenant with platform environments offers the platform step', async () =>
    {
        h.InHive()
        expect(await h.SignIn()).toEqual(Offered)
        expect(await h.Service.State()).toEqual(Offered)
        expect(h.Changes).toEqual([Offered])
        expect((await h.Store.Load()).Console).toMatchObject({ ConsoleUrl: Harness.Console, PlatformSignInUrl: Harness.Plane })
        expect((await h.Store.Load()).Platform).toBeUndefined()
    })

    it('a cached discovery still offers the platform step', async () =>
    {
        h.InHive()
        await h.Service.Discover(Harness.Platform, 'ada@acme.example')
        expect(await h.SignIn()).toEqual(Offered)
        expect(h.Fetch.To('/api/desktop/discover')).toHaveLength(1)
    })

    it('a tenant without platform environments is not offered the platform step', async () =>
    {
        h.InHive(false)
        expect(await h.SignIn()).toEqual({ SignedIn: true, Email: 'ada@acme.example', TenantName: 'Acme' })
        expect((await h.Store.Load()).Console!.PlatformSignInUrl).toBeUndefined()
    })

    it('a tenant signing in at the tenant plane itself is not offered the platform step', async () =>
    {
        h.Fetch.Routes.set('/api/desktop/discover', () => FakeFetch.Json(200, { tenants: [{ id: 't1', displayName: 'Acme', platformEnvironments: true }], tenantPlaneUrl: Harness.Plane }))
        expect(await h.SignIn()).toEqual({ SignedIn: true, Email: 'ada@acme.example', TenantName: 'Acme' })
        expect((await h.Store.Load()).Console!.PlatformSignInUrl).toBeUndefined()
    })

    it('a typed-console sign-in is never offered the platform step', async () =>
    {
        h.InHive()
        h.Fetch.Routes.set('/desktop/console', () => FakeFetch.Json(200, { tenantId: 't1', tenantName: 'Acme' }))
        expect(await h.Service.SignInAtConsole(Harness.Console, 'ada@acme.example')).toEqual({ SignedIn: true, Email: 'ada@acme.example', TenantName: 'Acme' })
        expect((await h.Store.Load()).Console!.PlatformSignInUrl).toBeUndefined()
    })

    it('SignInAtPlatform signs in at the tenant plane for the console tenant and stores the part', async () =>
    {
        h.InHive()
        await h.SignIn()
        expect(await h.Service.SignInAtPlatform()).toEqual(BothIn)
        const begins = h.Fetch.To('/desktop/sign-in/begin')
        expect(begins.map(b => b.Url)).toEqual([`${Harness.Console}/desktop/sign-in/begin`, `${Harness.Plane}/desktop/sign-in/begin`])
        expect(begins[1].Body).toMatchObject({ tenantId: 't1', redirectUri: FakeReceiver.Uri })
        expect(h.Fetch.At(`${Harness.Plane}/desktop/sign-in/complete`)).toHaveLength(1)
        expect(h.Opened).toEqual([Harness.Authorize, Harness.Authorize])
        expect(await h.Service.State()).toEqual(BothIn)
        expect(h.Changes.at(-1)).toEqual(BothIn)
        expect(JSON.stringify(h.Changes)).not.toContain('secret')
        const stored = await h.Store.Load()
        expect(stored.Console!.Token).toBe(ConsoleToken)
        expect(stored.Platform).toEqual({ ConsoleUrl: Harness.Plane, Token: PlatformToken, ExpiresAt: '2026-11-11T00:00:00.000Z', TenantId: 't1', Email: 'ada@acme.example' })
        expect(h.Receiver.Closed).toBe(2)
    })

    it('SessionFor answers each source with its own address and token', async () =>
    {
        await h.SignInBoth()
        expect(await h.Service.SessionFor(TargetSource.Console)).toEqual({ ConsoleUrl: Harness.Console, Token: ConsoleToken })
        expect(await h.Service.SessionFor(TargetSource.Platform)).toEqual({ ConsoleUrl: Harness.Plane, Token: PlatformToken })
    })

    it('a platform Complete for another tenant is ended at once and fails SignInFailed', async () =>
    {
        h.InHive()
        await h.SignIn()
        h.PlatformIssues('t-other', 'secret-platform-other')
        expect(await Caught.Kind(h.Service.SignInAtPlatform())).toBe(AccountErrorKind.SignInFailed)
        const ended = h.SignOutsWith('secret-platform-other')
        expect(ended.map(r => r.Url)).toEqual([`${Harness.Plane}/desktop/sign-out`])
        expect((await h.Store.Load()).Platform).toBeUndefined()
        expect(await h.Service.State()).toEqual(Offered)
    })

    it('SignInAtPlatform signed out is SignedOut, and without a platform address Unavailable, never dialling', async () =>
    {
        expect(await Caught.Kind(h.Service.SignInAtPlatform())).toBe(AccountErrorKind.SignedOut)
        h.InHive(false)
        await h.SignIn()
        const requests = h.Fetch.Requests.length
        expect(await Caught.Kind(h.Service.SignInAtPlatform())).toBe(AccountErrorKind.Unavailable)
        expect(h.Fetch.Requests).toHaveLength(requests)
        expect(h.Opened).toHaveLength(1)
    })

    it('a second platform sign-in ends the platform part it replaces', async () =>
    {
        await h.SignInBoth()
        h.PlatformIssues('t1', 'secret-platform-t1-again')
        expect(await h.Service.SignInAtPlatform()).toEqual(BothIn)
        expect(h.SignOutsWith(PlatformToken).map(r => r.Url)).toEqual([`${Harness.Plane}/desktop/sign-out`])
        expect((await h.Store.Load()).Platform!.Token).toBe('secret-platform-t1-again')
    })

    it('a cancel while the platform Complete is in flight ends the fresh platform session', async () =>
    {
        h.InHive()
        await h.SignIn()
        const gate = new Gate()
        h.Fetch.Routes.set(`${Harness.Plane}/desktop/sign-in/complete`, async () =>
        {
            await gate.Opened
            return FakeFetch.Json(200, { token: 'secret-platform-late', expiresAt: '2026-11-11T00:00:00.000Z', tenantId: 't1', tenantName: 'Acme', email: 'ada@acme.example' })
        })
        const signIn = Caught.Kind(h.Service.SignInAtPlatform())
        while (h.Fetch.At(`${Harness.Plane}/desktop/sign-in/complete`).length === 0) await new Promise(r => setTimeout(r, 1))
        await h.Service.CancelSignIn()
        gate.Release()
        expect(await signIn).toBe(AccountErrorKind.Cancelled)
        expect(h.SignOutsWith('secret-platform-late').map(r => r.Url)).toEqual([`${Harness.Plane}/desktop/sign-out`])
        expect((await h.Store.Load()).Platform).toBeUndefined()
        expect(await h.Service.State()).toEqual(Offered)
    })

    it('Targets merges the console and platform sets, each with its source', async () =>
    {
        await h.SignInBoth()
        expect(await h.Service.Targets()).toEqual({
            Contribute: [
                { Id: 'console:dev', Name: 'dev', Status: TargetStatus.Running, Source: TargetSource.Console },
                { Id: 'platform:dev', Name: 'dev', Status: TargetStatus.Stopped, Source: TargetSource.Platform },
            ],
            Publish: [
                { Id: 'console:prod', Name: 'prod', Status: TargetStatus.Stopped, Source: TargetSource.Console },
                { Id: 'platform:p-prod', Name: 'p-prod', Status: TargetStatus.Running, Source: TargetSource.Platform },
            ],
        })
        expect(h.Fetch.At(`${Harness.Console}/desktop/targets`)[0].Headers['authorization']).toBe(`Bearer ${ConsoleToken}`)
        expect(h.Fetch.At(`${Harness.Plane}/desktop/targets`)[0].Headers['authorization']).toBe(`Bearer ${PlatformToken}`)
    })

    it('a platform 401 clears only the platform part and answers the console set', async () =>
    {
        await h.SignInBoth()
        h.Fetch.Routes.set(`${Harness.Plane}/desktop/targets`, () => FakeFetch.Json(401, { error: 'signed-out' }))
        expect(await h.Service.Targets()).toEqual(ConsoleSet)
        const stored = await h.Store.Load()
        expect(stored.Console!.Token).toBe(ConsoleToken)
        expect(stored.Platform).toBeUndefined()
        expect(await h.Service.State()).toEqual(Offered)
        expect(h.Changes.at(-1)).toEqual(Offered)
    })

    it('an unreachable platform answers the console set and keeps the platform part', async () =>
    {
        await h.SignInBoth()
        h.Fetch.Routes.delete(`${Harness.Plane}/desktop/targets`)
        h.Fetch.Routes.delete('/desktop/targets')
        const changes = h.Changes.length
        expect(await h.Service.Targets()).toEqual(ConsoleSet)
        expect((await h.Store.Load()).Platform!.Token).toBe(PlatformToken)
        expect(await h.Service.State()).toEqual(BothIn)
        expect(h.Changes).toHaveLength(changes)
    })

    it('an expired platform part reads as Offered and Targets makes no platform call (Review Focus 1)', async () =>
    {
        await h.SignInBoth()
        h.Now = Date.parse('2026-11-11T00:00:00.001Z')
        expect(await h.Service.State()).toEqual(Offered)
        expect(await h.Service.SessionFor(TargetSource.Platform)).toBeUndefined()
        expect(await h.Service.Targets()).toEqual(ConsoleSet)
        expect(h.Fetch.At(`${Harness.Plane}/desktop/targets`)).toEqual([])
    })

    it('an expired platform part is dropped at the next write', async () =>
    {
        await h.SignInBoth()
        h.Now = Date.parse('2026-11-12T00:00:00.000Z')
        await h.Service.HandleSignedOut(ConsoleToken)
        expect(await h.Store.Load()).toEqual({ Console: undefined, Platform: undefined })
    })

    it('a console 401 keeps the platform part dormant: signed out, the part still stored', async () =>
    {
        await h.SignInBoth()
        await h.Service.HandleSignedOut(ConsoleToken)
        const stored = await h.Store.Load()
        expect(stored.Console).toBeUndefined()
        expect(stored.Platform!.Token).toBe(PlatformToken)
        expect(await h.Service.State()).toEqual({ SignedIn: false })
        expect(h.Changes.at(-1)).toEqual({ SignedIn: false })
        expect(await h.Service.SessionFor(TargetSource.Platform)).toBeUndefined()
        expect(h.SignOutsWith(PlatformToken)).toEqual([])
    })

    it('a console sign-in for the same tenant and email reattaches the dormant platform part', async () =>
    {
        await h.SignInBoth()
        await h.Service.HandleSignedOut(ConsoleToken)
        expect(await h.SignIn()).toEqual(BothIn)
        expect(h.Fetch.At(`${Harness.Plane}/desktop/sign-in/begin`)).toHaveLength(1)
        expect((await h.Store.Load()).Platform!.Token).toBe(PlatformToken)
        expect(h.SignOutsWith(PlatformToken)).toEqual([])
    })

    it('a console sign-in for another tenant ends and drops the platform part', async () =>
    {
        await h.SignInBoth()
        await h.Service.HandleSignedOut(ConsoleToken)
        h.InHive(false, 't2', 'Globex', 'ada@acme.example')
        expect(await h.SignIn('t2')).toEqual({ SignedIn: true, Email: 'ada@acme.example', TenantName: 'Globex' })
        expect(h.SignOutsWith(PlatformToken).map(r => r.Url)).toEqual([`${Harness.Plane}/desktop/sign-out`])
        expect((await h.Store.Load()).Platform).toBeUndefined()
    })

    it('a console sign-in for another email ends and drops the platform part', async () =>
    {
        await h.SignInBoth()
        h.InHive(true, 't1', 'Acme', 'bob@acme.example')
        expect(await h.SignIn('t1', 'bob@acme.example')).toEqual({ SignedIn: true, Email: 'bob@acme.example', TenantName: 'Acme', Platform: PlatformAccess.Offered })
        expect(h.SignOutsWith(PlatformToken).map(r => r.Url)).toEqual([`${Harness.Plane}/desktop/sign-out`])
        expect((await h.Store.Load()).Platform).toBeUndefined()
    })

    it('SignOut ends both parts at their own addresses and leaves nothing stored', async () =>
    {
        await h.SignInBoth()
        expect(await h.Service.SignOut()).toEqual({ SignedIn: false })
        expect(h.SignOutsWith(ConsoleToken).map(r => r.Url)).toEqual([`${Harness.Console}/desktop/sign-out`])
        expect(h.SignOutsWith(PlatformToken).map(r => r.Url)).toEqual([`${Harness.Plane}/desktop/sign-out`])
        expect(await h.Store.Load()).toEqual({ Console: undefined, Platform: undefined })
        expect(h.Changes.at(-1)).toEqual({ SignedIn: false })
    })

    it('SignOut ends a dormant platform part too', async () =>
    {
        await h.SignInBoth()
        await h.Service.HandleSignedOut(ConsoleToken)
        await h.Service.SignOut()
        expect(h.SignOutsWith(PlatformToken).map(r => r.Url)).toEqual([`${Harness.Plane}/desktop/sign-out`])
        expect(await h.Store.Load()).toEqual({ Console: undefined, Platform: undefined })
    })

    it('a stale platform 401 after a sign-out writes and emits nothing (Review Focus 5)', async () =>
    {
        await h.SignInBoth()
        await h.Service.SignOut()
        const saves = h.Saves
        const changes = h.Changes.length
        await h.Service.HandleSignedOut(PlatformToken)
        expect(h.Saves).toBe(saves)
        expect(h.Changes).toHaveLength(changes)
    })

    it('a stale platform 401 after a sign-out and a new sign-in writes and emits nothing (Review Focus 5)', async () =>
    {
        await h.SignInBoth()
        await h.Service.SignOut()
        // The new sign-in is issued its own platform token; the stale 401 names the old one.
        h.PlatformIssues('t1', 'secret-platform-t1-new')
        await h.SignIn()
        await h.Service.SignInAtPlatform()
        const saves = h.Saves
        const changes = h.Changes.length
        await h.Service.HandleSignedOut(PlatformToken)
        expect(h.Saves).toBe(saves)
        expect(h.Changes).toHaveLength(changes)
        expect(await h.Service.State()).toEqual(BothIn)
        expect((await h.Store.Load()).Platform!.Token).toBe('secret-platform-t1-new')
    })

    it('a platform 401 held in flight across a sign-out writes and emits nothing when it lands (Review Focus 5)', async () =>
    {
        await h.SignInBoth()
        const gate = new Gate()
        h.Fetch.Routes.set(`${Harness.Plane}/desktop/targets`, async () =>
        {
            await gate.Opened
            return FakeFetch.Json(401, { error: 'signed-out' })
        })
        const targets = h.Service.Targets()
        while (h.Fetch.At(`${Harness.Plane}/desktop/targets`).length === 0) await new Promise(r => setTimeout(r, 1))
        await h.Service.SignOut()
        const saves = h.Saves
        const changes = h.Changes.length
        gate.Release()
        expect(await targets).toEqual(ConsoleSet)
        expect(h.Saves).toBe(saves)
        expect(h.Changes).toHaveLength(changes)
        expect(await h.Store.Load()).toEqual({ Console: undefined, Platform: undefined })
    })

    it('a console 401 from Targets (an Owner reset on the console) leaves the platform part untouched', async () =>
    {
        await h.SignInBoth()
        h.Fetch.Routes.set(`${Harness.Console}/desktop/targets`, () => FakeFetch.Json(401, { error: 'signed-out' }))
        expect(await Caught.Kind(h.Service.Targets())).toBe(AccountErrorKind.SignedOut)
        const stored = await h.Store.Load()
        expect(stored.Console).toBeUndefined()
        expect(stored.Platform).toEqual({ ConsoleUrl: Harness.Plane, Token: PlatformToken, ExpiresAt: '2026-11-11T00:00:00.000Z', TenantId: 't1', Email: 'ada@acme.example' })
        expect(h.SignOutsWith(PlatformToken)).toEqual([])
    })

    it('a platform part committed while SignOut runs is ended, never left live and unheld', async () =>
    {
        h.InHive()
        await h.SignIn()
        const complete = new Gate()
        h.Fetch.Routes.set(`${Harness.Plane}/desktop/sign-in/complete`, async () =>
        {
            await complete.Opened
            return FakeFetch.Json(200, { token: 'secret-platform-mid', expiresAt: '2026-11-11T00:00:00.000Z', tenantId: 't1', tenantName: 'Acme', email: 'ada@acme.example' })
        })
        const consoleSignOut = new Gate()
        h.Fetch.Routes.set(`${Harness.Console}/desktop/sign-out`, async () =>
        {
            await consoleSignOut.Opened
            return new Response(null, { status: 204 })
        })
        const platform = Caught.Kind(h.Service.SignInAtPlatform())
        while (h.Fetch.At(`${Harness.Plane}/desktop/sign-in/complete`).length === 0) await new Promise(r => setTimeout(r, 1))
        const signOut = h.Service.SignOut()
        while (h.SignOutsWith(ConsoleToken).length === 0) await new Promise(r => setTimeout(r, 1))
        complete.Release()
        for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 1))
        consoleSignOut.Release()
        expect(await signOut).toEqual({ SignedIn: false })
        expect(await platform).toBe(AccountErrorKind.SignedOut)
        expect(h.SignOutsWith('secret-platform-mid').map(r => r.Url)).toEqual([`${Harness.Plane}/desktop/sign-out`])
        expect(await h.Store.Load()).toEqual({ Console: undefined, Platform: undefined })
        expect(h.Changes.at(-1)).toEqual({ SignedIn: false })
    })

    it('a store failure while dropping a 401 platform part still answers the console set', async () =>
    {
        await h.SignInBoth()
        h.Fetch.Routes.set(`${Harness.Plane}/desktop/targets`, () => FakeFetch.Json(401, { error: 'signed-out' }))
        h.Store.Save = async () => { throw new Error('disk full') }
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        try
        {
            expect(await h.Service.Targets()).toEqual(ConsoleSet)
            expect(warn).toHaveBeenCalledTimes(1)
            expect(JSON.stringify(warn.mock.calls)).not.toContain('secret')
            expect(JSON.stringify(warn.mock.calls)).not.toContain('disk full')
        }
        finally
        {
            warn.mockRestore()
        }
    })

    it('a platform commit is refused when the console part was replaced meanwhile, even for the same tenant and email', async () =>
    {
        h.InHive()
        await h.SignIn()
        const complete = new Gate()
        h.Fetch.Routes.set(`${Harness.Plane}/desktop/sign-in/complete`, async () =>
        {
            await complete.Opened
            return FakeFetch.Json(200, { token: 'secret-platform-orphan', expiresAt: '2026-11-11T00:00:00.000Z', tenantId: 't1', tenantName: 'Acme', email: 'ada@acme.example' })
        })
        const platform = Caught.Kind(h.Service.SignInAtPlatform())
        while (h.Fetch.At(`${Harness.Plane}/desktop/sign-in/complete`).length === 0) await new Promise(r => setTimeout(r, 1))
        const owner = (await h.Store.Load()).Console!
        await h.Store.Save({ Console: { ...owner, Token: 'secret-console-replacement' } })
        complete.Release()
        expect(await platform).toBe(AccountErrorKind.SignedOut)
        expect(h.SignOutsWith('secret-platform-orphan').map(r => r.Url)).toEqual([`${Harness.Plane}/desktop/sign-out`])
        const stored = await h.Store.Load()
        expect(stored.Console!.Token).toBe('secret-console-replacement')
        expect(stored.Platform).toBeUndefined()
    })

    it('a 401 for a dormant platform part drops it without emitting an unchanged state', async () =>
    {
        await h.SignInBoth()
        await h.Service.HandleSignedOut(ConsoleToken)
        const changes = h.Changes.length
        await h.Service.HandleSignedOut(PlatformToken)
        expect(await h.Store.Load()).toEqual({ Console: undefined, Platform: undefined })
        expect(h.Changes).toHaveLength(changes)
    })

    it('a platform 401 leaves the console part untouched', async () =>
    {
        await h.SignInBoth()
        const before = (await h.Store.Load()).Console
        await h.Service.HandleSignedOut(PlatformToken)
        expect((await h.Store.Load()).Console).toEqual(before)
        expect(h.SignOutsWith(ConsoleToken)).toEqual([])
    })
})
