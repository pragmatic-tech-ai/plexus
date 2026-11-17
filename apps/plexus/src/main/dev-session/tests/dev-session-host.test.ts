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

    public async DisposeAsync(): Promise<void>
    {
        this.Disposed++
    }
}

// Each Connect resolves after a delay chosen per call, so overlapping Opens interleave.
class SlowConnector implements IRelayConnector
{
    public readonly Made: FakeConn[] = []

    public constructor(private readonly delays: number[])
    {
    }

    public async Connect(_t: TargetRef, _a: RelayAction): Promise<RelayClient>
    {
        const conn = new FakeConn()
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
