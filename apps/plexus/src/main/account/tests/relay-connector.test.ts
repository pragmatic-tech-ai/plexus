import { describe, it, expect } from 'vitest'
import { AccountError, AccountErrorKind, TargetKind, TargetSource, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { ConnectionLostError, ErrorCodes, InMemoryMessageSocket, PragmaticClient, ResponseError, UpgradeRefusedError, type IMessageSocket } from '@pragmatic-tech-ai/pragmatic-protocol'
import { GraphErrorCode, RelayAnswer, RelayConnector, RelayDrop, RelayRefusal, type IRelaySessionSource, type RelayCall, type RelayClient } from '../relay-connector.js'
import type { SessionAddress } from '../desktop-session-store.js'

const Token = 'DESKTOP-SECRET-token-123'
const PlatformToken = 'PLATFORM-SECRET-token-456'

class FakeSessions implements IRelaySessionSource
{
    public SignedOutCalls = 0
    public readonly SignedOutTokens: string[] = []
    public readonly Asked: TargetSource[] = []
    public LoadFailure: unknown = undefined

    public constructor(public Current: SessionAddress | undefined, public Platform: SessionAddress | undefined = undefined)
    {
    }

    public async SessionFor(source: TargetSource): Promise<SessionAddress | undefined>
    {
        this.Asked.push(source)
        if (this.LoadFailure !== undefined) throw this.LoadFailure
        return source === TargetSource.Platform ? this.Platform : this.Current
    }

    public async HandleSignedOut(token: string): Promise<void>
    {
        this.SignedOutCalls++
        this.SignedOutTokens.push(token)
        if (this.Current?.Token === token) this.Current = undefined
        if (this.Platform?.Token === token) this.Platform = undefined
    }
}

class FakeDial
{
    public readonly Calls: Array<{ url: string; token: string }> = []
    public readonly Client = {} as RelayClient

    public constructor(private readonly failure: unknown = undefined)
    {
    }

    public readonly Dial = async (url: string, token: string): Promise<RelayClient> =>
    {
        this.Calls.push({ url, token })
        if (this.failure !== undefined) throw this.failure
        return this.Client
    }
}

// An IMessageSocket that reports `code` as its close code once the wrapped socket has closed, the way
// a ws socket reports the server's close frame.
class CodedSocket implements IMessageSocket
{
    private closed = false

    public constructor(private readonly inner: IMessageSocket, private readonly code: number)
    {
    }

    public Send(json: string): Promise<void>
    {
        return this.inner.Send(json)
    }

    public OnMessage(handler: (json: string) => void): void
    {
        this.inner.OnMessage(handler)
    }

    public OnError(handler: (error: Error) => void): void
    {
        this.inner.OnError(handler)
    }

    public OnClose(handler: () => void): void
    {
        this.inner.OnClose(() =>
        {
            this.closed = true
            handler()
        })
    }

    public Close(): void
    {
        this.inner.Close()
    }

    public CloseCode(): number | undefined
    {
        return this.closed ? this.code : undefined
    }
}

class RelayFixture
{
    public static Session(consoleUrl = 'http://127.0.0.1:7002'): SessionAddress
    {
        return { ConsoleUrl: consoleUrl, Token }
    }

    public static PlatformSession(): SessionAddress
    {
        return { ConsoleUrl: 'https://tenant-plane.example.com', Token: PlatformToken }
    }

    public static Console(name: string): TargetRef
    {
        return { Name: name, Source: TargetSource.Console }
    }

    public static Platform(name: string): TargetRef
    {
        return { Name: name, Source: TargetSource.Platform }
    }

    // A call on a relay whose socket closed with `code` (undefined: still open, or the transport cannot tell).
    public static Call(code: number | undefined = undefined, graph: string | undefined = undefined): RelayCall
    {
        return { Environment: 'dev', Graph: graph, Client: { CloseCode: () => code } }
    }

    // The error ws raises when the server answers the upgrade with a plain HTTP status.
    public static Refused(status: number): Error
    {
        return new Error(`Unexpected server response: ${status}`)
    }

    public static async Failure(promise: Promise<unknown>): Promise<Error>
    {
        try
        {
            await promise
        }
        catch (e)
        {
            return e as Error
        }
        throw new Error('expected rejection')
    }

    public static ExpectClean(error: Error): void
    {
        expect(error.message).not.toContain(Token)
        expect(error.message).not.toContain(PlatformToken)
        expect(error.message).not.toContain('Bearer')
        expect(error.message).not.toContain('127.0.0.1')
        expect(error.message).not.toContain('ws://')
    }
}

describe('RelayConnector', () =>
{
    it('dials the console relay for a console target\'s environment and action with the console token', async () =>
    {
        const dial = new FakeDial()
        const sessions = new FakeSessions(RelayFixture.Session())
        const relay = new RelayConnector(sessions, dial.Dial)
        const client = await relay.Connect(RelayFixture.Console('dev 1'), TargetKind.Contribute)
        expect(client).toBe(dial.Client)
        expect(dial.Calls).toEqual([{ url: 'ws://127.0.0.1:7002/desktop/relay?environment=dev%201&action=contribute', token: Token }])
        expect(sessions.Asked).toEqual([TargetSource.Console])
    })

    it('dials a platform target with the platform token at the platform address', async () =>
    {
        const dial = new FakeDial()
        const sessions = new FakeSessions(RelayFixture.Session(), RelayFixture.PlatformSession())
        await new RelayConnector(sessions, dial.Dial).Connect(RelayFixture.Platform('dev'), TargetKind.Publish)
        expect(dial.Calls).toEqual([{ url: 'wss://tenant-plane.example.com/desktop/relay?environment=dev&action=publish', token: PlatformToken }])
        expect(sessions.Asked).toEqual([TargetSource.Platform])
    })

    it('is PlatformSignedOut for a platform target without a platform part, and never dials', async () =>
    {
        const dial = new FakeDial()
        const error = await RelayFixture.Failure(new RelayConnector(new FakeSessions(RelayFixture.Session()), dial.Dial).Connect(RelayFixture.Platform('dev'), TargetKind.Contribute))
        expect(error).toBeInstanceOf(AccountError)
        expect((error as AccountError).Kind).toBe(AccountErrorKind.PlatformSignedOut)
        expect(dial.Calls).toHaveLength(0)
    })

    it('a platform 401 clears the platform token only and answers PlatformSignedOut', async () =>
    {
        const sessions = new FakeSessions(RelayFixture.Session(), RelayFixture.PlatformSession())
        const error = await RelayFixture.Failure(new RelayConnector(sessions, new FakeDial(new UpgradeRefusedError(401, '')).Dial).Connect(RelayFixture.Platform('dev'), TargetKind.Contribute))
        expect((error as AccountError).Kind).toBe(AccountErrorKind.PlatformSignedOut)
        expect(sessions.SignedOutTokens).toEqual([PlatformToken])
        expect(sessions.Current).toBeDefined()
        RelayFixture.ExpectClean(error)
    })

    it('a 503 with the retired console body is ConsoleRetired', async () =>
    {
        const sessions = new FakeSessions(RelayFixture.Session())
        const refusal = new UpgradeRefusedError(503, '{"error":"console-not-registered"}')
        const error = await RelayFixture.Failure(new RelayConnector(sessions, new FakeDial(refusal).Dial).Connect(RelayFixture.Console('dev'), TargetKind.Contribute))
        expect(error).toBeInstanceOf(AccountError)
        expect((error as AccountError).Kind).toBe(AccountErrorKind.ConsoleRetired)
        expect(sessions.SignedOutCalls).toBe(0)
    })

    it('any other 503 is the unreachable sentence', async () =>
    {
        const failures: unknown[] = [new UpgradeRefusedError(503, '{"error":"x"}'), new UpgradeRefusedError(503, 'not json'), RelayFixture.Refused(503)]
        for (const failure of failures)
        {
            const error = await RelayFixture.Failure(new RelayConnector(new FakeSessions(RelayFixture.Session()), new FakeDial(failure).Dial).Connect(RelayFixture.Console('dev'), TargetKind.Contribute))
            expect(error).not.toBeInstanceOf(AccountError)
            expect(error.message).toBe('The environment dev could not be reached.')
        }
    })

    it('uses wss for an https tenant plane and the publish action', async () =>
    {
        const dial = new FakeDial()
        await new RelayConnector(new FakeSessions(RelayFixture.Session('https://tenant.example.com')), dial.Dial).Connect(RelayFixture.Console('prod'), TargetKind.Publish)
        expect(dial.Calls[0]!.url).toBe('wss://tenant.example.com/desktop/relay?environment=prod&action=publish')
    })

    it('RelayUrl of a normalised https console', () =>
    {
        expect(RelayConnector.RelayUrl('https://console-acme.localtest.me', 'dev env', TargetKind.Contribute))
            .toBe('wss://console-acme.localtest.me/desktop/relay?environment=dev%20env&action=contribute')
    })

    it("relay dials the session's console address", async () =>
    {
        const dial = new FakeDial()
        await new RelayConnector(new FakeSessions(RelayFixture.Session('https://console-acme.localtest.me')), dial.Dial).Connect(RelayFixture.Console('dev'), TargetKind.Publish)
        expect(dial.Calls).toEqual([{ url: 'wss://console-acme.localtest.me/desktop/relay?environment=dev&action=publish', token: Token }])
    })

    it('relay certificate failure names the certificate', async () =>
    {
        const sessions = new FakeSessions(RelayFixture.Session('https://console-acme.localtest.me'))
        const failure = Object.assign(new Error('x'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' })
        const error = await RelayFixture.Failure(new RelayConnector(sessions, new FakeDial(failure).Dial).Connect(RelayFixture.Console('dev'), TargetKind.Contribute))
        expect(error).toBeInstanceOf(AccountError)
        expect((error as AccountError).Kind).toBe(AccountErrorKind.CertificateUntrusted)
        expect(sessions.SignedOutCalls).toBe(0)
        expect(sessions.Current).toBeDefined()
    })

    it('is SignedOut without a session and never dials', async () =>
    {
        const dial = new FakeDial()
        const error = await RelayFixture.Failure(new RelayConnector(new FakeSessions(undefined), dial.Dial).Connect(RelayFixture.Console('dev'), TargetKind.Contribute))
        expect(error).toBeInstanceOf(AccountError)
        expect((error as AccountError).Kind).toBe(AccountErrorKind.SignedOut)
        expect(error.message).toBe("You're signed out. Sign in and try again.")
        expect(dial.Calls).toHaveLength(0)
    })

    it('maps 401 to SignedOut and clears the account', async () =>
    {
        const sessions = new FakeSessions(RelayFixture.Session())
        const error = await RelayFixture.Failure(new RelayConnector(sessions, new FakeDial(RelayFixture.Refused(401)).Dial).Connect(RelayFixture.Console('dev'), TargetKind.Contribute))
        expect((error as AccountError).Kind).toBe(AccountErrorKind.SignedOut)
        expect(error.message).toBe("You're signed out. Sign in and try again.")
        expect(sessions.SignedOutCalls).toBe(1)
        expect(sessions.SignedOutTokens).toEqual([Token])
        RelayFixture.ExpectClean(error)
    })

    it('a session that cannot be read (a file-system error naming its path) becomes the Unavailable sentence, without dialing', async () =>
    {
        const sessions = new FakeSessions(RelayFixture.Session())
        sessions.LoadFailure = Object.assign(new Error("EACCES: permission denied, open 'C:\\Users\\ada\\AppData\\Plexus\\desktop-session.bin'"), { code: 'EACCES' })
        const dial = new FakeDial()
        const error = await RelayFixture.Failure(new RelayConnector(sessions, dial.Dial).Connect(RelayFixture.Console('dev'), TargetKind.Contribute))
        expect(error).toBeInstanceOf(AccountError)
        expect((error as AccountError).Kind).toBe(AccountErrorKind.Unavailable)
        expect(error.message).not.toContain('EACCES')
        expect(error.message).not.toContain('desktop-session')
        expect(dial.Calls).toHaveLength(0)
    })

    it('an account failure reading the session keeps its kind', async () =>
    {
        const sessions = new FakeSessions(RelayFixture.Session())
        sessions.LoadFailure = new AccountError(AccountErrorKind.SecureStorageUnavailable)
        const error = await RelayFixture.Failure(new RelayConnector(sessions, new FakeDial().Dial).Connect(RelayFixture.Console('dev'), TargetKind.Contribute))
        expect((error as AccountError).Kind).toBe(AccountErrorKind.SecureStorageUnavailable)
    })

    it('maps 403 to the not-allowed sentence', async () =>
    {
        const sessions = new FakeSessions(RelayFixture.Session())
        const error = await RelayFixture.Failure(new RelayConnector(sessions, new FakeDial(RelayFixture.Refused(403)).Dial).Connect(RelayFixture.Console('dev'), TargetKind.Publish))
        expect(error.message).toBe("Your account can't use this environment.")
        expect(sessions.SignedOutCalls).toBe(0)
        RelayFixture.ExpectClean(error)
    })

    it('maps 409 to the not-running sentence naming the environment', async () =>
    {
        const error = await RelayFixture.Failure(new RelayConnector(new FakeSessions(RelayFixture.Session()), new FakeDial(RelayFixture.Refused(409)).Dial).Connect(RelayFixture.Console('dev'), TargetKind.Contribute))
        expect(error.message).toBe('The environment dev is not running. Start it from the tenant console.')
        RelayFixture.ExpectClean(error)
    })

    it('maps 502, 400, other statuses and transport failures to the unreachable sentence', async () =>
    {
        const failures: unknown[] = [
            RelayFixture.Refused(502),
            RelayFixture.Refused(400),
            RelayFixture.Refused(500),
            new Error(`connect ECONNREFUSED 127.0.0.1:7002 Bearer ${Token}`),
            'not an error',
        ]
        for (const failure of failures)
        {
            const sessions = new FakeSessions(RelayFixture.Session())
            const error = await RelayFixture.Failure(new RelayConnector(sessions, new FakeDial(failure).Dial).Connect(RelayFixture.Console('dev'), TargetKind.Contribute))
            expect(error.message).toBe('The environment dev could not be reached.')
            expect(sessions.SignedOutCalls).toBe(0)
            RelayFixture.ExpectClean(error)
        }
    })

    it('reports an unusable tenant plane address as unreachable without dialing', async () =>
    {
        const dial = new FakeDial()
        const error = await RelayFixture.Failure(new RelayConnector(new FakeSessions(RelayFixture.Session('ftp://x')), dial.Dial).Connect(RelayFixture.Console('dev'), TargetKind.Contribute))
        expect(error.message).toBe('The environment dev could not be reached.')
        expect(dial.Calls).toHaveLength(0)
    })
})

describe('RelayRefusal.StatusOf', () =>
{
    it('reads the status from the ws upgrade refusal', () =>
    {
        expect(RelayRefusal.StatusOf(new Error('Unexpected server response: 401'))).toBe(401)
        expect(RelayRefusal.StatusOf(new Error('Unexpected server response: 502'))).toBe(502)
    })

    it('reads the status of an UpgradeRefusedError', () =>
    {
        expect(RelayRefusal.StatusOf(new UpgradeRefusedError(503, 'x'))).toBe(503)
    })

    it('prefers a structured status code when the error carries one', () =>
    {
        expect(RelayRefusal.StatusOf(Object.assign(new Error('refused'), { statusCode: 409 }))).toBe(409)
    })

    it('is undefined for anything else', () =>
    {
        expect(RelayRefusal.StatusOf(new Error('connect ECONNREFUSED'))).toBeUndefined()
        expect(RelayRefusal.StatusOf(new Error('Unexpected server response: abc'))).toBeUndefined()
        expect(RelayRefusal.StatusOf('Unexpected server response: 401')).toBeUndefined()
        expect(RelayRefusal.StatusOf(undefined)).toBeUndefined()
    })
})

describe('RelayRefusal.BodyOf', () =>
{
    it('is the body of an UpgradeRefusedError and undefined for anything else', () =>
    {
        expect(RelayRefusal.BodyOf(new UpgradeRefusedError(503, '{"error":"x"}'))).toBe('{"error":"x"}')
        expect(RelayRefusal.BodyOf(RelayFixture.Refused(503))).toBeUndefined()
        expect(RelayRefusal.BodyOf('body')).toBeUndefined()
        expect(RelayRefusal.BodyOf(undefined)).toBeUndefined()
    })
})

describe('RelayDrop.Is', () =>
{
    it('recognises a relay that went away mid-call', () =>
    {
        expect(RelayDrop.Is(new ConnectionLostError())).toBe(true)
        expect(RelayDrop.Is(new ResponseError(ErrorCodes.PendingResponseRejected, 'Pending response rejected since connection got disposed'))).toBe(true)
        expect(RelayDrop.Is(new ResponseError(ErrorCodes.MessageWriteError, 'write failed'))).toBe(true)
        expect(RelayDrop.Is(Object.assign(new Error('Connection is closed.'), { code: 1 }))).toBe(true)
        expect(RelayDrop.Is(Object.assign(new Error('Connection is disposed.'), { code: 2 }))).toBe(true)
    })

    it('leaves server answers and other failures alone', () =>
    {
        expect(RelayDrop.Is(new ResponseError(-32601, 'This method is not available through the desktop relay.'))).toBe(false)
        expect(RelayDrop.Is(new ResponseError(-32004, 'Graph g1 conflicts with existing contribution'))).toBe(false)
        expect(RelayDrop.Is(new Error('Solution s1 not found'))).toBe(false)
        expect(RelayDrop.Is('connection lost')).toBe(false)
    })
})

describe('RelayConnector.Call', () =>
{
    it('turns a mid-call drop into the unreachable sentence and keeps server answers', async () =>
    {
        await expect(RelayConnector.Call(RelayFixture.Call(), () => Promise.reject(new ConnectionLostError()))).rejects.toThrow('The environment dev could not be reached.')
        const conflict = new ResponseError(-32004, 'Graph g1 conflicts with existing contribution')
        await expect(RelayConnector.Call(RelayFixture.Call(), () => Promise.reject(conflict))).rejects.toBe(conflict)
        expect(await RelayConnector.Call(RelayFixture.Call(), async () => 7)).toBe(7)
    })

    it('a drop on a relay closed with 4003 is ConsoleRetired; any other close code is unreachable', async () =>
    {
        const retired = await RelayFixture.Failure(RelayConnector.Call(RelayFixture.Call(4003), () => Promise.reject(new ConnectionLostError())))
        expect(retired).toBeInstanceOf(AccountError)
        expect((retired as AccountError).Kind).toBe(AccountErrorKind.ConsoleRetired)
        const dropped = await RelayFixture.Failure(RelayConnector.Call(RelayFixture.Call(1006), () => Promise.reject(new ConnectionLostError())))
        expect(dropped).not.toBeInstanceOf(AccountError)
        expect(dropped.message).toBe('The environment dev could not be reached.')
    })

    it('a graph that is gone is the not-found sentence naming the graph and environment', async () =>
    {
        const error = await RelayFixture.Failure(RelayConnector.Call(RelayFixture.Call(undefined, 'g'), () => Promise.reject(new ResponseError(GraphErrorCode.NotFound, 'Graph not found: g'))))
        expect(error).not.toBeInstanceOf(ResponseError)
        expect(error.message).toBe('The graph g no longer exists in dev. Create it again in the tenant console.')
    })

    it('a package conflict is the conflict sentence naming the graph', async () =>
    {
        const error = await RelayFixture.Failure(RelayConnector.Call(RelayFixture.Call(undefined, 'g'), () => Promise.reject(new ResponseError(-32043, 'Package a@1.0.0 conflicts in g'))))
        expect(error).not.toBeInstanceOf(ResponseError)
        expect(error.message).toBe('A package version is already in g with different content.')
    })

    it('the other graph codes, and not-found or conflict without a graph, keep the server message', async () =>
    {
        const withGraph: ResponseError[] = [
            new ResponseError(-32041, 'Graph g already exists'),
            new ResponseError(-32042, 'Graph name is invalid'),
            new ResponseError(-32044, 'Package segment is invalid'),
            new ResponseError(-32045, 'Package a@1.0.0 is missing'),
        ]
        for (const answer of withGraph)
        {
            await expect(RelayConnector.Call(RelayFixture.Call(undefined, 'g'), () => Promise.reject(answer))).rejects.toBe(answer)
        }
        for (const answer of [new ResponseError(-32040, 'Graph not found: g'), new ResponseError(-32043, 'conflict')])
        {
            await expect(RelayConnector.Call(RelayFixture.Call(), () => Promise.reject(answer))).rejects.toBe(answer)
        }
    })

    it('a real dialer-less client closed mid-call with 4003 rejects, and the drop maps to ConsoleRetired', async () =>
    {
        const [clientEnd, serverEnd] = InMemoryMessageSocket.Pair()
        const client = PragmaticClient.CreateOverSocket(new CodedSocket(clientEnd, 4003))
        // The server side closes as soon as the request arrives: the call is in flight.
        serverEnd.OnMessage(() => serverEnd.Close())
        const error = await RelayFixture.Failure(RelayConnector.Call({ Environment: 'dev', Graph: 'g', Client: client }, () => client.ListGraphs()))
        expect(client.CloseCode()).toBe(4003)
        expect(error).toBeInstanceOf(AccountError)
        expect((error as AccountError).Kind).toBe(AccountErrorKind.ConsoleRetired)
        await client.DisposeAsync()
    })

    it('a real dialer-less client whose transport reports no close code maps a mid-call close to unreachable', async () =>
    {
        const [clientEnd, serverEnd] = InMemoryMessageSocket.Pair()
        const client = PragmaticClient.CreateOverSocket(clientEnd)
        serverEnd.OnMessage(() => serverEnd.Close())
        const error = await RelayFixture.Failure(RelayConnector.Call({ Environment: 'dev', Client: client }, () => client.ListGraphs()))
        expect(error.message).toBe('The environment dev could not be reached.')
        await client.DisposeAsync()
    })

    it('keeps the server answers the user acts on (conflict, not found, refused params, internal) and account failures', async () =>
    {
        const answers: unknown[] = [
            new ResponseError(-32004, 'Graph g1 conflicts with existing contribution'),
            new ResponseError(ErrorCodes.InvalidRequest, 'graph service is not available on this tenant'),
            new ResponseError(ErrorCodes.InvalidParams, 'invalid params: graph g1 not found'),
            new AccountError(AccountErrorKind.SignedOut),
        ]
        for (const answer of answers)
        {
            await expect(RelayConnector.Call(RelayFixture.Call(undefined, 'g1'), () => Promise.reject(answer))).rejects.toBe(answer)
        }
    })

    it('turns JSON-RPC protocol errors and local errors into a fixed sentence naming only the environment', async () =>
    {
        const failures: unknown[] = [
            new ResponseError(ErrorCodes.MethodNotFound, 'Unhandled method graph/contribute'),
            new ResponseError(ErrorCodes.ParseError, 'Parse error at 0x1f'),
            new ResponseError(ErrorCodes.ServerNotInitialized, 'Server not initialized'),
            new ResponseError(ErrorCodes.UnknownErrorCode, 'Unknown error'),
            new TypeError("Cannot read properties of undefined (reading 'name')"),
            'a string',
        ]
        for (const failure of failures)
        {
            const error = await RelayFixture.Failure(RelayConnector.Call(RelayFixture.Call(), () => Promise.reject(failure)))
            expect(error).not.toBeInstanceOf(ResponseError)
            expect(error.message).toBe('The environment dev could not handle this request. It may need an update.')
        }
    })
})

describe('RelayAnswer', () =>
{
    it('tells a server answer from a protocol error', () =>
    {
        expect(RelayAnswer.IsServerAnswer(new ResponseError(-32004, 'conflict'))).toBe(true)
        expect(RelayAnswer.IsServerAnswer(new ResponseError(ErrorCodes.MethodNotFound, 'Method not found'))).toBe(false)
        expect(RelayAnswer.IsServerAnswer(new Error('x'))).toBe(false)
    })
})
