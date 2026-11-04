import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { rootCertificates as tlsRootCertificates } from 'node:tls'
import { IdpLoginError, IdpPasswordLogin } from '../idp-password-login'

// A local HTTP server for one test; Close() shuts it.
class FakeServer
{
    public Port = 0
    private readonly server: Server

    public constructor(handler: (req: IncomingMessage, body: string, res: ServerResponse) => void)
    {
        this.server = createServer((req, res) =>
        {
            const chunks: Buffer[] = []
            req.on('data', (c: Buffer) => chunks.push(c))
            req.on('end', () => handler(req, Buffer.concat(chunks).toString('utf8'), res))
        })
    }

    public async Start(): Promise<this>
    {
        await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', () => resolve()))
        this.Port = (this.server.address() as AddressInfo).port
        return this
    }

    public Close(): Promise<void>
    {
        return new Promise((resolve) => this.server.close(() => resolve()))
    }
}

// The servers one test started; CloseAll() shuts them after it.
class FakeServers
{
    private readonly started: FakeServer[] = []

    public async Serve(handler: (req: IncomingMessage, body: string, res: ServerResponse) => void): Promise<FakeServer>
    {
        const server = await new FakeServer(handler).Start()
        this.started.push(server)
        return server
    }

    public async CloseAll(): Promise<void>
    {
        await Promise.all(this.started.splice(0).map((s) => s.Close()))
    }
}

const EMAIL = 'owner@example.test'
const PASSWORD = 'p@ss word&=1'
const COOKIE = 'idp_login=abc123'

describe('IdpPasswordLogin pure helpers', () => {
    it('replays every cookie name=value and drops attributes', () => {
        expect(IdpPasswordLogin.CookieHeader(['a=1; Path=/; HttpOnly', 'b=2; Secure'])).toBe('a=1; b=2')
        expect(IdpPasswordLogin.CookieHeader([])).toBe('')
        expect(IdpPasswordLogin.CookieHeader(['garbage'])).toBe('')
    })

    it('url-encodes the email and password form fields', () => {
        const parsed = new URLSearchParams(IdpPasswordLogin.FormBody(EMAIL, PASSWORD))
        expect(parsed.get('email')).toBe(EMAIL)
        expect(parsed.get('password')).toBe(PASSWORD)
    })

    it('accepts a redirect to the loopback callback carrying a code and state', () => {
        const url = IdpPasswordLogin.LoopbackCallback({ Status: 302, SetCookie: [], Location: 'http://127.0.0.1:5123/pragmatic-desktop/callback?code=c&state=s' })
        expect(url.port).toBe('5123')
    })

    it('rejects a non-redirect answer (the login form came back, e.g. a wrong password)', () => {
        expect(() => IdpPasswordLogin.LoopbackCallback({ Status: 200, SetCookie: [], Location: undefined })).toThrow(IdpLoginError)
    })

    it('rejects a redirect anywhere but the http loopback callback', () => {
        for (const location of [
            'https://127.0.0.1:5123/pragmatic-desktop/callback?code=c&state=s',
            'http://evil.example/pragmatic-desktop/callback?code=c&state=s',
            'http://127.0.0.1:5123/elsewhere?code=c&state=s',
            'not a url',
        ])
        {
            expect(() => IdpPasswordLogin.LoopbackCallback({ Status: 302, SetCookie: [], Location: location })).toThrow(IdpLoginError)
        }
    })

    it('rejects a callback with an error or without code and state', () => {
        const base = 'http://127.0.0.1:5123/pragmatic-desktop/callback'
        expect(() => IdpPasswordLogin.LoopbackCallback({ Status: 302, SetCookie: [], Location: `${base}?error=access_denied&state=s` })).toThrow(/error/)
        expect(() => IdpPasswordLogin.LoopbackCallback({ Status: 302, SetCookie: [], Location: `${base}?state=s` })).toThrow(/without a code/)
    })

    it('never puts the password or code into an error message', () => {
        try
        {
            IdpPasswordLogin.LoopbackCallback({ Status: 302, SetCookie: [], Location: 'http://evil.example/x?code=secret-code&state=s' })
        }
        catch (e)
        {
            expect(String((e as Error).message)).not.toContain('secret-code')
        }
    })
})

describe('IdpPasswordLogin.Run against a fake IdP and loopback', () => {
    const servers = new FakeServers()
    afterEach(() => servers.CloseAll())

    it('GETs the page, POSTs the form with the cookie, and follows the redirect to the loopback', async () => {
        const received: string[] = []
        const loopback = await servers.Serve((req, _body, res) => { received.push(req.url ?? ''); res.writeHead(200); res.end() })
        const posted: { cookie?: string; form?: string } = {}
        const idp = await servers.Serve((req, body, res) =>
        {
            if (req.method === 'GET')
            {
                res.writeHead(200, { 'set-cookie': [`${COOKIE}; Path=/; HttpOnly`] })
                res.end('<form/>')
                return
            }
            posted.cookie = req.headers.cookie
            posted.form = body
            res.writeHead(302, { location: `http://127.0.0.1:${loopback.Port}/pragmatic-desktop/callback?code=c1&state=s1` })
            res.end()
        })

        await new IdpPasswordLogin().Run(`http://127.0.0.1:${idp.Port}/authorize?state=s1`, EMAIL, PASSWORD)

        expect(posted.cookie).toBe(COOKIE)
        expect(new URLSearchParams(posted.form).get('password')).toBe(PASSWORD)
        expect(received).toEqual(['/pragmatic-desktop/callback?code=c1&state=s1'])
    })

    it('fails clearly when the password is refused (the form comes back)', async () => {
        const idp = await servers.Serve((req, _body, res) =>
        {
            res.writeHead(200, req.method === 'GET' ? { 'set-cookie': [COOKIE] } : {})
            res.end('<form/>')
        })
        await expect(new IdpPasswordLogin().Run(`http://127.0.0.1:${idp.Port}/authorize`, EMAIL, PASSWORD))
            .rejects.toThrow(/did not redirect, status 200/)
    })

    it('fails when the loopback refuses the code', async () => {
        const loopback = await servers.Serve((_req, _body, res) => { res.writeHead(400); res.end() })
        const idp = await servers.Serve((req, _body, res) =>
        {
            if (req.method === 'GET')
            {
                res.writeHead(200, { 'set-cookie': [COOKIE] })
                res.end()
                return
            }
            res.writeHead(302, { location: `http://127.0.0.1:${loopback.Port}/pragmatic-desktop/callback?code=c&state=s` })
            res.end()
        })
        await expect(new IdpPasswordLogin().Run(`http://127.0.0.1:${idp.Port}/authorize`, EMAIL, PASSWORD))
            .rejects.toThrow(/status 400/)
    })
})

describe('IdpPasswordLogin transport policy', () => {
    const servers = new FakeServers()
    afterEach(() => servers.CloseAll())

    it('refuses an http authorize URL on a non-loopback host before sending anything', async () => {
        await expect(new IdpPasswordLogin().Run('http://idp.example.test/authorize?state=s', EMAIL, PASSWORD))
            .rejects.toThrow(/must be https/)
    })

    it('accepts http only on a loopback host', () => {
        expect(IdpPasswordLogin.IsSecureEnough(new URL('http://127.0.0.1:7000/authorize'))).toBe(true)
        expect(IdpPasswordLogin.IsSecureEnough(new URL('http://localhost/authorize'))).toBe(true)
        expect(IdpPasswordLogin.IsSecureEnough(new URL('https://idp.example.test/authorize'))).toBe(true)
        expect(IdpPasswordLogin.IsSecureEnough(new URL('http://idp.example.test/authorize'))).toBe(false)
    })

    it('adds the dev CA to the default trust instead of replacing it', () => {
        const ca = Buffer.from('-----BEGIN CERTIFICATE-----\nDEV\n-----END CERTIFICATE-----\n')
        const trust = IdpPasswordLogin.TrustFor(ca)!
        expect(trust).toContain(ca.toString())
        for (const root of tlsRootCertificates) expect(trust).toContain(root)
        expect(IdpPasswordLogin.TrustFor(undefined)).toBeUndefined()
    })

    it('follows one same-origin redirect from the authorize URL to the login page and posts the form there', async () => {
        const loopback = await servers.Serve((_req, _body, res) => { res.writeHead(200); res.end() })
        const posted: { path?: string; cookie?: string } = {}
        const idp = await servers.Serve((req, _body, res) =>
        {
            if (req.method === 'GET' && req.url?.startsWith('/authorize'))
            {
                res.writeHead(302, { location: '/login?flow=1', 'set-cookie': ['first=1; Path=/'] })
                res.end()
                return
            }
            if (req.method === 'GET')
            {
                res.writeHead(200, { 'set-cookie': [`${COOKIE}; Path=/`] })
                res.end('<form/>')
                return
            }
            posted.path = req.url
            posted.cookie = req.headers.cookie
            res.writeHead(302, { location: `http://127.0.0.1:${loopback.Port}/pragmatic-desktop/callback?code=c&state=s` })
            res.end()
        })

        await new IdpPasswordLogin().Run(`http://127.0.0.1:${idp.Port}/authorize?state=s`, EMAIL, PASSWORD)

        expect(posted.path).toBe('/login?flow=1')
        expect(posted.cookie).toBe(`first=1; ${COOKIE}`)
    })

    it('does not follow a redirect to another origin', async () => {
        const idp = await servers.Serve((_req, _body, res) =>
        {
            res.writeHead(302, { location: 'http://127.0.0.2:1/login' })
            res.end()
        })
        await expect(new IdpPasswordLogin().Run(`http://127.0.0.1:${idp.Port}/authorize`, EMAIL, PASSWORD))
            .rejects.toThrow(/did not load, status 302/)
    })
})
