import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AccountError, AccountErrorKind } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { DesktopApiClient } from '../desktop-api-client.js'
import { DesktopSessionStore, type DesktopSession, type ITokenEncryptor } from '../desktop-session-store.js'

class ReverseEncryptor implements ITokenEncryptor
{
    public IsAvailable(): boolean { return true }
    public Encrypt(plain: string): Buffer { return Buffer.from([...plain].reverse().join('')) }
    public Decrypt(blob: Buffer): string { return [...blob.toString()].reverse().join('') }
}

type Recorded = { Url: string; Method: string; Headers: Record<string, string> }

// A fetch double answering every request with one response (or one rejection), recording each call.
class FakeFetch
{
    public readonly Requests: Recorded[] = []
    public Answer: () => Response | Promise<Response> = () => FakeFetch.Json(200, {})

    public readonly Fetch = async (input: string | URL, init?: RequestInit): Promise<Response> =>
    {
        this.Requests.push({ Url: String(input), Method: init?.method ?? 'GET', Headers: Object.fromEntries(new Headers(init?.headers).entries()) })
        return await this.Answer()
    }

    public static Json(status: number, body: unknown): Response
    {
        return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    }

    // The error Node's fetch raises: a TypeError whose cause carries the socket's code.
    public static Failed(code: string): TypeError
    {
        return Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(`${code} detail`), { code }) })
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

describe('DesktopApiClient', () =>
{
    const session: DesktopSession = {
        ConsoleUrl: 'https://console-acme.example', Token: 'tok-1', Email: 'ada@acme.example', TenantId: 'acme', TenantName: 'Acme', ExpiresAt: '2099-01-01T00:00:00Z',
    }
    let fake: FakeFetch
    let client: DesktopApiClient
    let dir: string

    beforeEach(() =>
    {
        fake = new FakeFetch()
        client = new DesktopApiClient(fake.Fetch as typeof fetch)
        dir = mkdtempSync(join(tmpdir(), 'desktop-api-client-'))
    })
    afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

    it("Discover keeps each tenant's console address and falls back to the tenant plane", async () =>
    {
        fake.Answer = () => FakeFetch.Json(200, {
            tenants: [{ id: 'a', displayName: 'A', consoleUrl: 'https://console-a.example' }, { id: 'b', displayName: 'B' }, { id: 'c', displayName: 'C', consoleUrl: '' }, { id: 'd', displayName: 'D', consoleUrl: 7 }],
            tenantPlaneUrl: 'http://127.0.0.1:7002',
        })
        const found = await client.Discover('http://localhost:7000', 'ada@acme.example')
        expect(found.TenantPlaneUrl).toBe('http://127.0.0.1:7002')
        expect(found.Tenants[0]!.ConsoleUrl).toBe('https://console-a.example')
        expect(found.Tenants[1]!.ConsoleUrl).toBe('http://127.0.0.1:7002')
        expect(found.Tenants[2]!.ConsoleUrl).toBe('http://127.0.0.1:7002')
        expect(found.Tenants[3]!.ConsoleUrl).toBe('http://127.0.0.1:7002')
        expect(found.Tenants[0]).toEqual({ Id: 'a', DisplayName: 'A', ConsoleUrl: 'https://console-a.example' })
    })

    it('Console answers the served tenant', async () =>
    {
        fake.Answer = () => FakeFetch.Json(200, { tenantId: 'acme', tenantName: 'Acme' })
        expect(await client.Console('https://console-acme.example')).toEqual({ TenantId: 'acme', TenantName: 'Acme' })
        expect(fake.Requests).toHaveLength(1)
        const [request] = fake.Requests
        expect(request!.Url).toBe('https://console-acme.example/desktop/console')
        expect(request!.Method).toBe('GET')
        expect(request!.Headers['authorization']).toBeUndefined()
        expect(request!.Headers['origin']).toBeUndefined()
    })

    it('Console names the tenant by its id when the console gives no name', async () =>
    {
        fake.Answer = () => FakeFetch.Json(200, { tenantId: 'acme' })
        expect(await client.Console('https://console-acme.example')).toEqual({ TenantId: 'acme', TenantName: 'acme' })
    })

    it('Console maps 404 and non-JSON 200 to NotAConsole', async () =>
    {
        const answers: Array<() => Response> = [
            () => FakeFetch.Json(404, { error: 'not-found' }),
            () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
            () => FakeFetch.Json(200, {}),
            () => FakeFetch.Json(200, { tenantId: '' }),
            () => FakeFetch.Json(200, [{ tenantId: 'acme' }]),
            () => FakeFetch.Json(403, {}),
        ]
        for (const answer of answers)
        {
            fake.Answer = answer
            expect(await Caught.Kind(client.Console('https://console-acme.example'))).toBe(AccountErrorKind.NotAConsole)
        }
    })

    it('Console maps a throttled or failing console to Unavailable', async () =>
    {
        for (const status of [429, 500, 503])
        {
            fake.Answer = () => FakeFetch.Json(status, {})
            expect(await Caught.Kind(client.Console('https://console-acme.example'))).toBe(AccountErrorKind.Unavailable)
        }
    })

    it('a certificate failure is CertificateUntrusted, not Unreachable', async () =>
    {
        fake.Answer = () => { throw FakeFetch.Failed('SELF_SIGNED_CERT_IN_CHAIN') }
        expect(await Caught.Kind(client.Console('https://console-acme.example'))).toBe(AccountErrorKind.CertificateUntrusted)
        expect(await Caught.Kind(client.Discover('https://platform.example', 'ada@acme.example'))).toBe(AccountErrorKind.CertificateUntrusted)
        expect(await Caught.Kind(client.Targets(session))).toBe(AccountErrorKind.CertificateUntrusted)
    })

    it('console calls that cannot connect are ConsoleUnreachable', async () =>
    {
        fake.Answer = () => { throw FakeFetch.Failed('ECONNREFUSED') }
        expect(await Caught.Kind(client.Begin('https://console-acme.example', 'acme', 'http://127.0.0.1:5555/cb', 'ch'))).toBe(AccountErrorKind.ConsoleUnreachable)
        expect(await Caught.Kind(client.Complete('https://console-acme.example', 'st', 'code', 'ver'))).toBe(AccountErrorKind.ConsoleUnreachable)
        expect(await Caught.Kind(client.Console('https://console-acme.example'))).toBe(AccountErrorKind.ConsoleUnreachable)
        expect(await Caught.Kind(client.Targets(session))).toBe(AccountErrorKind.ConsoleUnreachable)
        expect(await Caught.Kind(client.SignOut(session))).toBe(AccountErrorKind.ConsoleUnreachable)
        expect(await Caught.Kind(client.Discover('http://localhost:7000', 'ada@acme.example'))).toBe(AccountErrorKind.Unreachable)
    })

    it('targets and sign-out of a legacy session go to the platform tenant plane', async () =>
    {
        const encryptor = new ReverseEncryptor()
        const legacy = { TenantPlaneUrl: 'http://127.0.0.1:7002', Token: 'tok-legacy', Email: 'ada@acme.example', TenantId: 't1', TenantName: 'Acme', ExpiresAt: '2099-01-01T00:00:00Z' }
        writeFileSync(join(dir, 'desktop-session.bin'), encryptor.Encrypt(JSON.stringify(legacy)))
        const loaded = await new DesktopSessionStore(dir, encryptor).Load()
        expect(loaded).toBeDefined()
        fake.Answer = () => FakeFetch.Json(200, { contribute: [], publish: [] })
        await client.Targets(loaded!)
        fake.Answer = () => new Response(null, { status: 204 })
        await client.SignOut(loaded!)
        expect(fake.Requests.map(r => r.Url)).toEqual(['http://127.0.0.1:7002/desktop/targets', 'http://127.0.0.1:7002/desktop/sign-out'])
        expect(fake.Requests[0]!.Headers['authorization']).toBe('Bearer tok-legacy')
    })
})
