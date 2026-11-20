import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TargetSource } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { AccountService } from '../account-service.js'
import { DesktopApiClient } from '../desktop-api-client.js'
import { DesktopSessionStore } from '../desktop-session-store.js'
import { LoopbackRedirectReceiver } from '../loopback-redirect-receiver.js'
import { RelayAction, RelayConnector } from '../relay-connector.js'
import { RealmTokenClient } from '../realm-sign-in.js'
import { FakeRealm } from './fake-realm.js'
import { ReverseEncryptor } from './reverse-encryptor.js'

// One HTTP server standing in for the platform edge, a hive's tenant admin console and its realm
// sign-in service, enforcing the server dependencies of spec 2026-11-20-e section 5 as strictly as
// a fake can, so this file pins Plexus's side of each contract over real HTTP:
//   S1  the public client `plexus`: no secret anywhere, PKCE S256, state and nonce, a loopback
//       redirect on any port, refresh tokens that rotate (reuse revokes the family);
//   S2  access tokens the console accepts as the bearer (JWT-shaped, audience the console);
//   S3  token and revocation endpoints on the issuer's public origin (here: the same server);
//   S4  GET /desktop/console naming { signIn: { issuer, clientId } };
//   S5  realm access tokens as the bearer on /desktop/targets and /desktop/sign-out;
//   S6  the relay URL the bearer is presented at (the dial is a recorded double here).
// Discovery (POST /api/desktop/discover) is today's contract, unchanged.
class ContractHive
{
    public static readonly ClientId = 'plexus'
    public static readonly LoopbackPath = '/pragmatic-desktop/callback'
    public readonly Violations: string[] = []
    public readonly Revoked: string[] = []
    public Base = ''
    public AccessSeconds = 600
    private readonly server: Server
    private readonly codes = new Map<string, { Challenge: string; Redirect: string; Nonce: string }>()
    private readonly liveRefresh = new Set<string>()
    private readonly usedRefresh = new Set<string>()
    private readonly liveAccess = new Set<string>()
    private serial = 0

    public constructor()
    {
        this.server = createServer((req, res) => void this.Answer(req, res))
    }

    public get Issuer(): string
    {
        return `${this.Base}/realms/acme`
    }

    public async Start(): Promise<void>
    {
        await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', () => resolve()))
        this.Base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
    }

    public Stop(): Promise<void>
    {
        this.server.closeAllConnections()
        return new Promise(resolve => this.server.close(() => resolve()))
    }

    public IsLiveRefresh(token: string): boolean
    {
        return this.liveRefresh.has(token)
    }

    // The system browser: opens the authorize URL and follows the realm's redirect to the loopback.
    public async Browse(authorizeUrl: string): Promise<void>
    {
        const res = await fetch(authorizeUrl, { redirect: 'manual' })
        const location = res.headers.get('location')
        if (location === null) throw new Error(`the realm answered ${res.status} without a redirect`)
        await (await fetch(location)).text()
    }

    private Violation(text: string): void
    {
        this.Violations.push(text)
    }

    private async Answer(req: IncomingMessage, res: ServerResponse): Promise<void>
    {
        const url = new URL(req.url ?? '/', this.Base)
        const body = await ContractHive.Body(req)
        const route = `${req.method} ${url.pathname}`
        const realm = '/realms/acme'
        switch (route)
        {
            case 'POST /api/desktop/discover':
                return ContractHive.Json(res, 200, { tenants: [{ id: 't1', displayName: 'Acme', consoleUrl: this.Base }] })
            case 'GET /desktop/console':
                if (req.headers.origin !== undefined) this.Violation('lookup sent an Origin header')
                return ContractHive.Json(res, 200, { tenantId: 't1', tenantName: 'Acme Corp', signIn: { issuer: this.Issuer, clientId: ContractHive.ClientId } })
            case `GET ${realm}/.well-known/openid-configuration`:
                return ContractHive.Json(res, 200, {
                    issuer: this.Issuer,
                    authorization_endpoint: `${this.Issuer}/protocol/openid-connect/auth`,
                    token_endpoint: `${this.Issuer}/protocol/openid-connect/token`,
                    revocation_endpoint: `${this.Issuer}/protocol/openid-connect/revoke`,
                    code_challenge_methods_supported: ['S256'],
                    token_endpoint_auth_methods_supported: ['none'],
                })
            case `GET ${realm}/protocol/openid-connect/auth`:
                return this.Authorize(url.searchParams, res)
            case `POST ${realm}/protocol/openid-connect/token`:
                return this.Token(req, new URLSearchParams(body), res)
            case `POST ${realm}/protocol/openid-connect/revoke`:
                return this.Revoke(req, new URLSearchParams(body), res)
            case 'GET /desktop/targets':
                if (!this.Bearer(req)) return ContractHive.Json(res, 401, {})
                return ContractHive.Json(res, 200, { contribute: [{ name: 'dev', status: 'running' }], publish: [{ name: 'prod', status: 'running' }] })
            case 'POST /desktop/sign-out':
                this.Bearer(req)
                res.writeHead(204).end()
                return
            default:
                this.Violation(`unexpected ${route}`)
                res.writeHead(404).end()
        }
    }

    private Authorize(p: URLSearchParams, res: ServerResponse): void
    {
        const redirect = p.get('redirect_uri') ?? ''
        const loopback = new URL(redirect)
        if (loopback.protocol !== 'http:' || loopback.hostname !== '127.0.0.1' || loopback.pathname !== ContractHive.LoopbackPath) this.Violation('redirect is not the loopback callback')
        if (p.get('client_id') !== ContractHive.ClientId) this.Violation('authorize client is not plexus')
        if (p.get('response_type') !== 'code') this.Violation('response_type is not code')
        if (p.get('code_challenge_method') !== 'S256') this.Violation('challenge method is not S256')
        if (!(p.get('scope') ?? '').split(' ').includes('openid')) this.Violation('scope lacks openid')
        if (!(p.get('scope') ?? '').split(' ').includes('offline_access')) this.Violation('scope lacks offline_access')
        if ((p.get('state') ?? '') === '' || (p.get('nonce') ?? '') === '') this.Violation('state or nonce missing')
        const code = `code-${++this.serial}`
        this.codes.set(code, { Challenge: p.get('code_challenge') ?? '', Redirect: redirect, Nonce: p.get('nonce') ?? '' })
        loopback.searchParams.set('code', code)
        loopback.searchParams.set('state', p.get('state') ?? '')
        res.writeHead(302, { location: loopback.toString() }).end()
    }

    private Token(req: IncomingMessage, form: URLSearchParams, res: ServerResponse): void
    {
        if (req.headers.authorization !== undefined || form.has('client_secret')) this.Violation('the public client presented a secret')
        if (!(req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) this.Violation('token request is not form-encoded')
        if (form.get('client_id') !== ContractHive.ClientId) return ContractHive.Json(res, 401, { error: 'invalid_client' })
        if (form.get('grant_type') === 'authorization_code')
        {
            const code = this.codes.get(form.get('code') ?? '')
            this.codes.delete(form.get('code') ?? '')
            const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url')
            if (code === undefined || code.Challenge !== challenge || code.Redirect !== form.get('redirect_uri')) return ContractHive.Json(res, 400, { error: 'invalid_grant' })
            const now = Math.floor(Date.now() / 1000)
            const idToken = FakeRealm.IdToken({ iss: this.Issuer, aud: ContractHive.ClientId, azp: ContractHive.ClientId, sub: 'acct-1', email: 'ada@acme.example', iat: now, exp: now + 300, nonce: code.Nonce })
            return ContractHive.Json(res, 200, { access_token: this.Access(), token_type: 'Bearer', expires_in: this.AccessSeconds, refresh_token: this.Refresh(), id_token: idToken })
        }
        if (form.get('grant_type') === 'refresh_token')
        {
            const presented = form.get('refresh_token') ?? ''
            if (this.usedRefresh.has(presented))
            {
                this.Violation('a spent refresh token was presented again')
                this.liveRefresh.clear()
                return ContractHive.Json(res, 400, { error: 'invalid_grant' })
            }
            if (!this.liveRefresh.delete(presented)) return ContractHive.Json(res, 400, { error: 'invalid_grant' })
            this.usedRefresh.add(presented)
            return ContractHive.Json(res, 200, { access_token: this.Access(), token_type: 'Bearer', expires_in: this.AccessSeconds, refresh_token: this.Refresh() })
        }
        return ContractHive.Json(res, 400, { error: 'unsupported_grant_type' })
    }

    private Revoke(req: IncomingMessage, form: URLSearchParams, res: ServerResponse): void
    {
        if (req.headers.authorization !== undefined || form.has('client_secret')) this.Violation('the public client presented a secret')
        if (form.get('client_id') !== ContractHive.ClientId) this.Violation('revocation without client_id')
        if (form.get('token_type_hint') !== 'refresh_token') this.Violation('revocation hint is not refresh_token')
        const token = form.get('token') ?? ''
        this.Revoked.push(token)
        this.liveRefresh.delete(token)
        res.writeHead(200).end()
    }

    private Bearer(req: IncomingMessage): boolean
    {
        if (req.headers.origin !== undefined) this.Violation('a desktop call sent an Origin header')
        const header = req.headers.authorization ?? ''
        return header.startsWith('Bearer ') && this.liveAccess.has(header.slice('Bearer '.length))
    }

    private Access(): string
    {
        const token = FakeRealm.IdToken({ typ: 'at+jwt', aud: 'pragmatic-tenant-admin', azp: ContractHive.ClientId, n: ++this.serial })
        this.liveAccess.add(token)
        return token
    }

    private Refresh(): string
    {
        const token = `refresh-${++this.serial}`
        this.liveRefresh.add(token)
        return token
    }

    private static Json(res: ServerResponse, status: number, body: unknown): void
    {
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
    }

    private static Body(req: IncomingMessage): Promise<string>
    {
        return new Promise((resolve, reject) =>
        {
            const chunks: Buffer[] = []
            req.on('data', (c: Buffer) => chunks.push(c))
            req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
            req.on('error', reject)
        })
    }
}

describe('the realm desktop contract over HTTP (spec 2026-11-20-e, S1-S6)', () =>
{
    let hive: ContractHive
    let dir: string
    let now: number
    let service: AccountService

    beforeEach(async () =>
    {
        hive = new ContractHive()
        await hive.Start()
        dir = mkdtempSync(join(tmpdir(), 'realm-contract-'))
        now = Date.now()
        service = new AccountService(
            new DesktopSessionStore(dir, new ReverseEncryptor()), dir, new DesktopApiClient(), () => new LoopbackRedirectReceiver(),
            url => hive.Browse(url), () => now, new RealmTokenClient(globalThis.fetch, () => now),
        )
    })

    afterEach(async () =>
    {
        await hive.Stop()
        rmSync(dir, { recursive: true, force: true })
    })

    it('finds the hive, signs in at its realm, lists, refreshes, relays and signs out', async () =>
    {
        expect(await service.Discover(hive.Base, 'ada@acme.example')).toEqual([{ Id: 't1', DisplayName: 'Acme' }])
        expect(await service.SignIn(hive.Base, 'ada@acme.example', 't1')).toEqual({ SignedIn: true, Email: 'ada@acme.example', TenantName: 'Acme Corp' })

        const targets = await service.Targets()
        expect(targets.Contribute.map(t => t.Name)).toEqual(['dev'])
        expect(targets.Publish.map(t => t.Name)).toEqual(['prod'])

        // Close to expiry: the next use renews the access token first, with the rotated refresh token.
        now += 570_000
        const first = await service.SessionFor(TargetSource.Console)
        now += 570_000
        const second = await service.SessionFor(TargetSource.Console)
        expect(second!.Token).not.toBe(first!.Token)
        expect((await service.Targets()).Contribute).toHaveLength(1)

        // The relay is dialled with the realm access token as the bearer (S5, S6).
        const dialled: { Url: string; Token: string }[] = []
        const relay = new RelayConnector(service, async (url, token) =>
        {
            dialled.push({ Url: url, Token: token })
            return {} as never
        })
        await relay.Connect({ Name: 'dev', Source: TargetSource.Console }, RelayAction.Contribute)
        expect(dialled).toEqual([{ Url: `${hive.Base.replace('http:', 'ws:')}/desktop/relay?environment=dev&action=contribute`, Token: second!.Token }])

        await service.SignOut()
        expect(hive.Revoked).toHaveLength(1)
        expect(hive.IsLiveRefresh(hive.Revoked[0])).toBe(false)
        expect(await service.State()).toEqual({ SignedIn: false })
        expect(hive.Violations).toEqual([])
    })

    it('signs in from a typed console address (Standalone hives, no discovery through us)', async () =>
    {
        expect(await service.SignInAtConsole(hive.Base, 'ada@acme.example')).toEqual({ SignedIn: true, Email: 'ada@acme.example', TenantName: 'Acme Corp' })
        expect((await service.Targets()).Contribute).toHaveLength(1)
        expect(hive.Violations).toEqual([])
    })
})
