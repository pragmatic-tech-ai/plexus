import { describe, it, expect } from 'vitest'
import { AccountError, AccountErrorKind, TargetKind } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { ConnectionLostError, ErrorCodes, ResponseError } from '@pragmatic-tech-ai/pragmatic-protocol'
import { RelayConnector, RelayDrop, RelayRefusal, type IRelaySessionSource, type RelayClient } from '../relay-connector.js'
import type { DesktopSession } from '../desktop-session-store.js'

const Token = 'DESKTOP-SECRET-token-123'

class FakeSessions implements IRelaySessionSource
{
    public SignedOutCalls = 0

    public constructor(public Current: DesktopSession | undefined)
    {
    }

    public async Session(): Promise<DesktopSession | undefined>
    {
        return this.Current
    }

    public async HandleSignedOut(): Promise<void>
    {
        this.SignedOutCalls++
        this.Current = undefined
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

class RelayFixture
{
    public static Session(plane = 'http://127.0.0.1:7002'): DesktopSession
    {
        return { TenantPlaneUrl: plane, Token, Email: 'o@acme.test', TenantId: 't1', TenantName: 'Acme', ExpiresAt: '2099-01-01T00:00:00Z' }
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
        expect(error.message).not.toContain('Bearer')
        expect(error.message).not.toContain('127.0.0.1')
        expect(error.message).not.toContain('ws://')
    }
}

describe('RelayConnector', () =>
{
    it('dials the tenant plane relay for the environment and action with the desktop token', async () =>
    {
        const dial = new FakeDial()
        const relay = new RelayConnector(new FakeSessions(RelayFixture.Session()), dial.Dial)
        const client = await relay.Connect('dev 1', TargetKind.Contribute)
        expect(client).toBe(dial.Client)
        expect(dial.Calls).toEqual([{ url: 'ws://127.0.0.1:7002/desktop/relay?environment=dev%201&action=contribute', token: Token }])
    })

    it('uses wss for an https tenant plane and the publish action', async () =>
    {
        const dial = new FakeDial()
        await new RelayConnector(new FakeSessions(RelayFixture.Session('https://tenant.example.com')), dial.Dial).Connect('prod', TargetKind.Publish)
        expect(dial.Calls[0]!.url).toBe('wss://tenant.example.com/desktop/relay?environment=prod&action=publish')
    })

    it('is SignedOut without a session and never dials', async () =>
    {
        const dial = new FakeDial()
        const error = await RelayFixture.Failure(new RelayConnector(new FakeSessions(undefined), dial.Dial).Connect('dev', TargetKind.Contribute))
        expect(error).toBeInstanceOf(AccountError)
        expect((error as AccountError).Kind).toBe(AccountErrorKind.SignedOut)
        expect(error.message).toBe("You're signed out. Sign in and try again.")
        expect(dial.Calls).toHaveLength(0)
    })

    it('maps 401 to SignedOut and clears the account', async () =>
    {
        const sessions = new FakeSessions(RelayFixture.Session())
        const error = await RelayFixture.Failure(new RelayConnector(sessions, new FakeDial(RelayFixture.Refused(401)).Dial).Connect('dev', TargetKind.Contribute))
        expect((error as AccountError).Kind).toBe(AccountErrorKind.SignedOut)
        expect(error.message).toBe("You're signed out. Sign in and try again.")
        expect(sessions.SignedOutCalls).toBe(1)
        RelayFixture.ExpectClean(error)
    })

    it('maps 403 to the not-allowed sentence', async () =>
    {
        const sessions = new FakeSessions(RelayFixture.Session())
        const error = await RelayFixture.Failure(new RelayConnector(sessions, new FakeDial(RelayFixture.Refused(403)).Dial).Connect('dev', TargetKind.Publish))
        expect(error.message).toBe("Your account can't use this environment.")
        expect(sessions.SignedOutCalls).toBe(0)
        RelayFixture.ExpectClean(error)
    })

    it('maps 409 to the not-running sentence naming the environment', async () =>
    {
        const error = await RelayFixture.Failure(new RelayConnector(new FakeSessions(RelayFixture.Session()), new FakeDial(RelayFixture.Refused(409)).Dial).Connect('dev', TargetKind.Contribute))
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
            const error = await RelayFixture.Failure(new RelayConnector(sessions, new FakeDial(failure).Dial).Connect('dev', TargetKind.Contribute))
            expect(error.message).toBe('The environment dev could not be reached.')
            expect(sessions.SignedOutCalls).toBe(0)
            RelayFixture.ExpectClean(error)
        }
    })

    it('reports an unusable tenant plane address as unreachable without dialing', async () =>
    {
        const dial = new FakeDial()
        const error = await RelayFixture.Failure(new RelayConnector(new FakeSessions(RelayFixture.Session('ftp://x')), dial.Dial).Connect('dev', TargetKind.Contribute))
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
        await expect(RelayConnector.Call('dev', () => Promise.reject(new ConnectionLostError()))).rejects.toThrow('The environment dev could not be reached.')
        const conflict = new ResponseError(-32004, 'Graph g1 conflicts with existing contribution')
        await expect(RelayConnector.Call('dev', () => Promise.reject(conflict))).rejects.toBe(conflict)
        expect(await RelayConnector.Call('dev', async () => 7)).toBe(7)
    })
})
