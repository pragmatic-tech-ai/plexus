import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { AccountError, AccountErrorKind } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'

// What the account service needs from the browser hand-back (a fake in tests).
export interface IRedirectReceiver
{
    Start(): Promise<{ RedirectUri: string }>;
    WaitForCode(expectedState: string, timeoutMs?: number): Promise<string>;
    Cancel(): void;
    Close(): Promise<void>;
}

// The RFC 8252 loopback redirect: a one-shot HTTP listener on an ephemeral 127.0.0.1 port that
// receives the authorization code from the system browser. Only the callback path with the
// expected state settles the wait; anything else is answered and ignored. The listener closes as
// soon as the wait settles (code, browser error, time-out or cancel), and Close is idempotent so
// the caller can always run it in a finally.
export class LoopbackRedirectReceiver implements IRedirectReceiver
{
    public static readonly DefaultTimeoutMs = 300_000
    private static readonly Scheme = 'http://'
    private static readonly Host = '127.0.0.1'
    private static readonly RootPath = '/'
    private static readonly CallbackPath = '/pragmatic-desktop/callback'
    private static readonly StateParam = 'state'
    private static readonly CodeParam = 'code'
    private static readonly ErrorParam = 'error'
    private static readonly ConnectionEvent = 'connection'
    private static readonly CloseEvent = 'close'
    private static readonly ErrorEvent = 'error'
    private static readonly HtmlType = 'text/html; charset=utf-8'
    private static readonly TextType = 'text/plain; charset=utf-8'
    private static readonly ContentTypeHeader = 'Content-Type'
    private static readonly CacheControlHeader = 'Cache-Control'
    private static readonly NoStore = 'no-store'
    private static readonly StatusOk = 200
    private static readonly StatusBadRequest = 400
    private static readonly StatusNotFound = 404
    private static readonly DonePage = '<!doctype html><html><head><meta charset="utf-8"><title>Plexus</title></head><body><p>You can close this tab and return to Plexus.</p></body></html>'
    private static readonly FailedPage = '<!doctype html><html><head><meta charset="utf-8"><title>Plexus</title></head><body><p>Sign-in did not finish. You can close this tab and try again in Plexus.</p></body></html>'
    private static readonly NotFoundText = 'Not found.'
    private static readonly BadRequestText = 'This sign-in link is not the one Plexus is waiting for.'
    private static readonly NotStarted = 'The loopback receiver was not started.'
    private static readonly ResponseCloseEvent = 'close'

    private server: Server | undefined
    // Every open socket, so Close also drops browser pre-connects that never sent a request (the
    // http server only tracks connections that did).
    private readonly sockets = new Set<Socket>()
    private closing: Promise<void> | undefined
    // Set by Close (and so by Cancel and time-out): the receiver is single-use, nothing restarts it.
    private finished = false
    private expectedState: string | undefined
    private settle: { resolve: (code: string) => void; reject: (e: AccountError) => void } | undefined
    private timer: ReturnType<typeof setTimeout> | undefined

    public async Start(): Promise<{ RedirectUri: string }>
    {
        if (this.finished) throw new AccountError(AccountErrorKind.Cancelled)
        const server = createServer((req, res) => this.Answer(req, res))
        this.server = server
        server.on(LoopbackRedirectReceiver.ConnectionEvent, socket =>
        {
            this.sockets.add(socket)
            socket.once(LoopbackRedirectReceiver.CloseEvent, () => this.sockets.delete(socket))
        })
        await new Promise<void>((resolve, reject) =>
        {
            server.once(LoopbackRedirectReceiver.ErrorEvent, reject)
            server.listen(0, LoopbackRedirectReceiver.Host, () => { server.off(LoopbackRedirectReceiver.ErrorEvent, reject); resolve() })
        })
        if (this.finished)
        {
            await this.CloseServer(server)
            throw new AccountError(AccountErrorKind.Cancelled)
        }
        const { port } = server.address() as AddressInfo
        return { RedirectUri: `${LoopbackRedirectReceiver.Scheme}${LoopbackRedirectReceiver.Host}:${port}${LoopbackRedirectReceiver.CallbackPath}` }
    }

    public WaitForCode(expectedState: string, timeoutMs = LoopbackRedirectReceiver.DefaultTimeoutMs): Promise<string>
    {
        if (this.finished) return Promise.reject(new AccountError(AccountErrorKind.Cancelled))
        if (this.server === undefined) return Promise.reject(new Error(LoopbackRedirectReceiver.NotStarted))
        this.expectedState = expectedState
        return new Promise<string>((resolve, reject) =>
        {
            this.settle = { resolve, reject }
            this.timer = setTimeout(() => this.Fail(AccountErrorKind.TimedOut), timeoutMs)
        })
    }

    public Cancel(): void
    {
        this.Fail(AccountErrorKind.Cancelled)
    }

    public Close(): Promise<void>
    {
        this.finished = true
        this.ClearTimer()
        const pending = this.settle
        this.settle = undefined
        pending?.reject(new AccountError(AccountErrorKind.Cancelled))
        if (this.closing !== undefined) return this.closing
        const server = this.server
        if (server === undefined) return Promise.resolve()
        this.closing = this.CloseServer(server)
        return this.closing
    }

    private CloseServer(server: Server): Promise<void>
    {
        return new Promise<void>(resolve =>
        {
            server.close(() => resolve())
            server.closeAllConnections()
            for (const socket of this.sockets) socket.destroy()
        })
    }

    private Answer(req: IncomingMessage, res: ServerResponse): void
    {
        const url = new URL(req.url ?? LoopbackRedirectReceiver.RootPath, `${LoopbackRedirectReceiver.Scheme}${LoopbackRedirectReceiver.Host}`)
        if (url.pathname !== LoopbackRedirectReceiver.CallbackPath)
        {
            this.Reply(res, LoopbackRedirectReceiver.StatusNotFound, LoopbackRedirectReceiver.TextType, LoopbackRedirectReceiver.NotFoundText)
            return
        }
        const state = url.searchParams.get(LoopbackRedirectReceiver.StateParam)
        if (this.settle === undefined || state === null || state !== this.expectedState)
        {
            this.Reply(res, LoopbackRedirectReceiver.StatusBadRequest, LoopbackRedirectReceiver.TextType, LoopbackRedirectReceiver.BadRequestText)
            return
        }
        const code = url.searchParams.get(LoopbackRedirectReceiver.CodeParam)
        // Detach the wait so no second request can settle it, but settle only once the page has been
        // written (or the connection is gone), so closing the listener never cuts the page off.
        const pending = this.settle
        this.settle = undefined
        this.ClearTimer()
        const failed = url.searchParams.has(LoopbackRedirectReceiver.ErrorParam) || code === null || code === ''
        let settled = false
        const settle = (): void =>
        {
            if (settled) return
            settled = true
            if (failed) pending.reject(new AccountError(AccountErrorKind.SignInFailed))
            else pending.resolve(code as string)
            void this.Close()
        }
        res.once(LoopbackRedirectReceiver.ResponseCloseEvent, settle)
        this.Reply(res, LoopbackRedirectReceiver.StatusOk, LoopbackRedirectReceiver.HtmlType, failed ? LoopbackRedirectReceiver.FailedPage : LoopbackRedirectReceiver.DonePage, settle)
    }

    // Time-out and cancel: rejects the pending wait (if any) only once the listener is closed, so a
    // caller that sees the rejection can rely on the port being gone.
    private Fail(kind: AccountErrorKind): void
    {
        const pending = this.settle
        this.settle = undefined
        this.ClearTimer()
        void this.Close().then(() => pending?.reject(new AccountError(kind)))
    }

    private Reply(res: ServerResponse, status: number, type: string, body: string, then?: () => void): void
    {
        res.writeHead(status, { [LoopbackRedirectReceiver.ContentTypeHeader]: type, [LoopbackRedirectReceiver.CacheControlHeader]: LoopbackRedirectReceiver.NoStore })
        res.end(body, then)
    }

    private ClearTimer(): void
    {
        if (this.timer !== undefined) clearTimeout(this.timer)
        this.timer = undefined
    }
}
