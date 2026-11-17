import { describe, it, expect } from 'vitest'
import type { StorageChangedPayload } from '@pragmatic-tech-ai/pragmatic-protocol'
import { TargetSource } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { DevelopSession } from '../develop-session.js'
import { RelayAction, type IRelayConnector, type RelayClient } from '../relay-connector.js'

// A relay client whose storage calls block until released, recording how many are in flight.
class FakeClient
{
    public InFlight = 0
    public MaxSeen = 0
    public Disposed = 0
    private readonly waiting: Array<() => void> = []
    private handler: ((c: StorageChangedPayload) => void) | undefined
    public Unsubscribed = 0

    public get Waiting(): number
    {
        return this.waiting.length
    }

    public RejectPaths = new Set<string>()

    public async StorageReadText(path: string): Promise<string>
    {
        this.InFlight++
        this.MaxSeen = Math.max(this.MaxSeen, this.InFlight)
        await new Promise<void>(resolve => this.waiting.push(resolve))
        this.InFlight--
        if (this.RejectPaths.has(path)) throw new Error(`boom:${path}`)
        return `text:${path}`
    }

    public async StorageList(): Promise<Array<{ Name: string; IsDirectory: boolean }>>
    {
        return [{ Name: 'a', IsDirectory: false }]
    }

    public ReleaseAll(): void
    {
        while (this.waiting.length > 0) this.waiting.shift()!()
    }

    public OnStorageChanged(handler: (c: StorageChangedPayload) => void): { dispose(): void }
    {
        this.handler = handler
        return { dispose: () => { this.Unsubscribed++; this.handler = undefined } }
    }

    public Push(change: StorageChangedPayload): void
    {
        this.handler?.(change)
    }

    public async DisposeAsync(): Promise<void>
    {
        this.Disposed++
    }

    public AsClient(): RelayClient
    {
        return this as unknown as RelayClient
    }
}

class Ticks
{
    public static Settle(): Promise<void>
    {
        return new Promise(resolve => setTimeout(resolve, 0))
    }
}

describe('DevelopSession', () =>
{
    it('never has more than MaxInFlight requests in flight and resolves them all', async () =>
    {
        const fake = new FakeClient()
        const session = new DevelopSession(fake.AsClient())
        const results = Array.from({ length: 50 }, (_, i) => session.ReadText(`p${i}`))
        await Ticks.Settle()
        expect(fake.InFlight).toBe(DevelopSession.MaxInFlight)
        expect(fake.Waiting).toBe(DevelopSession.MaxInFlight)
        while (fake.Waiting > 0)
        {
            fake.ReleaseAll()
            await Ticks.Settle()
        }
        const all = await Promise.all(results)
        expect(all).toHaveLength(50)
        expect(all[49]).toBe('text:p49')
        expect(fake.MaxSeen).toBeLessThanOrEqual(DevelopSession.MaxInFlight)
        expect(DevelopSession.MaxInFlight).toBeLessThan(32) // 32 = server RelayPipe.MaxPending (pragmatic-server control-plane); keep in step
    })

    it('a rejecting request releases its slot and the queue keeps draining', async () =>
    {
        const fake = new FakeClient()
        for (let i = 0; i < 40; i += 3) fake.RejectPaths.add(`p${i}`)
        const session = new DevelopSession(fake.AsClient())
        const results = Array.from({ length: 70 }, (_, i) => session.ReadText(`p${i}`).then(() => 'ok', () => 'err'))
        await Ticks.Settle()
        while (fake.Waiting > 0)
        {
            fake.ReleaseAll()
            await Ticks.Settle()
        }
        const all = await Promise.all(results)
        expect(all).toHaveLength(70)
        expect(all.filter(r => r === 'err')).toHaveLength(fake.RejectPaths.size)
        expect(fake.MaxSeen).toBeLessThanOrEqual(DevelopSession.MaxInFlight)
    })

    it('Dispose with requests queued closes once and does not drop them silently', async () =>
    {
        const fake = new FakeClient()
        const session = new DevelopSession(fake.AsClient())
        const results = Array.from({ length: 40 }, (_, i) => session.ReadText(`p${i}`))
        await Ticks.Settle()
        await session.Dispose()
        expect(fake.Disposed).toBe(1)
        while (fake.Waiting > 0)
        {
            fake.ReleaseAll()
            await Ticks.Settle()
        }
        expect(await Promise.all(results)).toHaveLength(40)
        expect(fake.Disposed).toBe(1)
    })

    it('delegates List through the serializer', async () =>
    {
        const session = new DevelopSession(new FakeClient().AsClient())
        expect(await session.List('.')).toEqual([{ Name: 'a', IsDirectory: false }])
    })

    it('delivers storage changes to a subscriber and the disposer unsubscribes', () =>
    {
        const fake = new FakeClient()
        const session = new DevelopSession(fake.AsClient())
        const seen: StorageChangedPayload[] = []
        const off = session.OnStorageChanged(c => seen.push(c))
        fake.Push({ Kind: 'added', Path: 'x', IsDirectory: false })
        expect(seen).toHaveLength(1)
        off()
        expect(fake.Unsubscribed).toBe(1)
        fake.Push({ Kind: 'added', Path: 'y', IsDirectory: false })
        expect(seen).toHaveLength(1)
    })

    it('Dispose closes the connection exactly once', async () =>
    {
        const fake = new FakeClient()
        const session = new DevelopSession(fake.AsClient())
        await session.Dispose()
        await session.Dispose()
        expect(fake.Disposed).toBe(1)
    })

    it('Connect opens a held Develop relay', async () =>
    {
        const fake = new FakeClient()
        const calls: RelayAction[] = []
        const connector: IRelayConnector = { Connect: async (_t, a) => { calls.push(a); return fake.AsClient() } }
        const session = await DevelopSession.Connect(connector, { Name: 'dev', Source: TargetSource.Console })
        expect(calls).toEqual([RelayAction.Develop])
        expect(fake.Disposed).toBe(0)
        await session.Dispose()
        expect(fake.Disposed).toBe(1)
    })
})
