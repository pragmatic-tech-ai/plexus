import { describe, it, expect } from 'vitest'
import { TargetSource, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { DevSessionHost } from '../dev-session-host.js'
import type { IRelayConnector, RelayAction, RelayClient } from '../../account/relay-connector.js'

class FakeConn
{
    public Disposed = 0
    public Unsubscribed = 0

    public OnStorageChanged(): { dispose(): void }
    {
        return { dispose: () => { this.Unsubscribed++ } }
    }

    public readonly PushHandlers = new Map<string, (p: unknown) => void>()
    public PushUnsubscribed = 0

    public OnGraphChanged(handler: (p: unknown) => void): { dispose(): void }
    {
        return this.PushSubscription('OnGraphChanged', handler)
    }

    public OnBuildStateChanged(handler: (p: unknown) => void): { dispose(): void }
    {
        return this.PushSubscription('OnBuildStateChanged', handler)
    }

    public ThrowOnDiagnostics = false

    public OnDiagnostics(handler: (p: unknown) => void): { dispose(): void }
    {
        if (this.ThrowOnDiagnostics) throw new Error('subscribe failed')
        return this.PushSubscription('OnDiagnostics', handler)
    }

    private PushSubscription(name: string, handler: (p: unknown) => void): { dispose(): void }
    {
        this.PushHandlers.set(name, handler)
        return { dispose: () => { this.PushUnsubscribed++ } }
    }

    public async DisposeAsync(): Promise<void>
    {
        this.Disposed++
    }
}

// Each Connect resolves after a delay chosen per call, so overlapping Opens interleave.
class SlowConnector implements IRelayConnector
{
    public readonly Made: FakeConn[] = []

    public constructor(private readonly delays: number[], private readonly throwOnDiagnostics = false)
    {
    }

    public async Connect(_t: TargetRef, _a: RelayAction): Promise<RelayClient>
    {
        const conn = new FakeConn()
        conn.ThrowOnDiagnostics = this.throwOnDiagnostics
        this.Made.push(conn)
        await new Promise(resolve => setTimeout(resolve, this.delays.shift() ?? 0))
        return conn as unknown as RelayClient
    }
}

class Targets
{
    public static readonly Dev: TargetRef = { Name: 'dev', Source: TargetSource.Console }
}

describe('DevSessionHost', () =>
{
    it('overlapping Opens leave exactly one live session and dispose the other', async () =>
    {
        const connector = new SlowConnector([20, 0])
        const host = new DevSessionHost(connector)
        await Promise.all([host.Open(Targets.Dev), host.Open(Targets.Dev)])
        const live = connector.Made.filter(c => c.Disposed === 0)
        expect(connector.Made).toHaveLength(2)
        expect(live).toHaveLength(1)
        expect(connector.Made[0].Disposed).toBe(1)
        expect(connector.Made[0].Unsubscribed).toBe(1)
        expect(host.Session).toBeDefined()
    })

    it('a Close during an Open closes the session it opened', async () =>
    {
        const connector = new SlowConnector([20])
        const host = new DevSessionHost(connector)
        const opening = host.Open(Targets.Dev)
        const closing = host.Close()
        await Promise.all([opening, closing])
        expect(connector.Made[0].Disposed).toBe(1)
        expect(connector.Made[0].Unsubscribed).toBe(1)
        expect(() => host.Session).toThrow()
    })
})

describe('DevSessionHost push fan-out', () =>
{
    it.each([['OnGraphChanged'], ['OnBuildStateChanged'], ['OnDiagnostics']])('%s reaches every registered handler until it is removed or the session closes', async (name) =>
    {
        const connector = new SlowConnector([0])
        const host = new DevSessionHost(connector)
        const a: unknown[] = []
        const b: unknown[] = []
        const offA = (host as any)[name]((p: unknown) => a.push(p))
        ;(host as any)[name]((p: unknown) => b.push(p))
        await host.Open(Targets.Dev)
        const push = connector.Made[0].PushHandlers.get(name)!
        push({ n: 1 })
        expect(a).toEqual([{ n: 1 }])
        expect(b).toEqual([{ n: 1 }])
        offA()
        push({ n: 2 })
        expect(a).toHaveLength(1)
        expect(b).toHaveLength(2)
        await host.Close()
        expect(connector.Made[0].PushUnsubscribed).toBe(3)
    })
})

describe('DevSessionHost throwing subscription', () =>
{
    it('disposes the subscriptions already made and leaves no half-open session', async () =>
    {
        const connector = new SlowConnector([0], true)
        const host = new DevSessionHost(connector)
        await expect(host.Open(Targets.Dev)).rejects.toThrow('subscribe failed')
        expect(() => host.Session).toThrow()
        expect(connector.Made[0].Unsubscribed).toBe(1)
        expect(connector.Made[0].PushUnsubscribed).toBe(2)
        expect(connector.Made[0].Disposed).toBe(1)
    })
})
