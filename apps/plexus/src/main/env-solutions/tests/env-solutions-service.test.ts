import { describe, expect, it } from 'vitest'
import { TargetSource, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { EnvSolutionsService } from '../env-solutions-service.js'
import { RelayAction, type IRelayConnector, type RelayClient } from '../../account/relay-connector.js'

class FakeClient
{
    public ListCalls = 0
    public Closed = 0

    constructor(private readonly names: string[], private readonly failure?: Error)
    {
    }

    public async ListSolutions(): Promise<Array<{ Name: string; Id: string }>>
    {
        this.ListCalls++
        if (this.failure !== undefined) throw this.failure
        return this.names.map((Name, i) => ({ Name, Id: `s${i}` }))
    }

    public async DisposeAsync(): Promise<void>
    {
        this.Closed++
    }

    public CloseCode(): number | undefined
    {
        return undefined
    }
}

class FakeRelay implements IRelayConnector
{
    public Connects: Array<{ target: TargetRef; action: RelayAction }> = []

    constructor(private readonly client: FakeClient)
    {
    }

    public async Connect(target: TargetRef, action: RelayAction): Promise<RelayClient>
    {
        this.Connects.push({ target, action })
        return this.client as unknown as RelayClient
    }
}

describe('EnvSolutionsService', () =>
{
    const dev: TargetRef = { Name: 'dev', Source: TargetSource.Platform }

    it('opens a develop relay, lists the solution names sorted, and closes', async () =>
    {
        const client = new FakeClient(['b', 'a'])
        const relay = new FakeRelay(client)
        await expect(new EnvSolutionsService(relay).ListSolutions(dev)).resolves.toEqual(['a', 'b'])
        expect(relay.Connects).toEqual([{ target: dev, action: RelayAction.Develop }])
        expect(client.ListCalls).toBe(1)
        expect(client.Closed).toBe(1)
    })

    it('closes the relay when the listing fails', async () =>
    {
        const client = new FakeClient([], new Error('boom'))
        await expect(new EnvSolutionsService(new FakeRelay(client)).ListSolutions(dev)).rejects.toBeDefined()
        expect(client.Closed).toBe(1)
    })
})
