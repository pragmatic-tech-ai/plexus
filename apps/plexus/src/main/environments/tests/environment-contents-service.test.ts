import { describe, expect, it } from 'vitest'
import { ConnectionLostError, ErrorCodes, ResponseError } from '@pragmatic-tech-ai/pragmatic-protocol'
import { TargetSource, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { EnvironmentContentsService } from '../environment-contents-service.js'
import { RelayAction, type IRelayConnector, type RelayClient } from '../../account/relay-connector.js'

type Read<T> = T | Error

class FakeClient
{
    public Closed = 0
    public DisposeFails = false

    constructor(
        private readonly apps: Read<any[]> = [],
        private readonly graphs: Read<any[]> = [],
        private readonly loaded: Read<any | null> = null)
    {
    }

    public async ListApplications(): Promise<any[]>
    {
        return FakeClient.Take(this.apps)
    }

    public async ListGraphs(): Promise<any[]>
    {
        return FakeClient.Take(this.graphs)
    }

    public async GetLoadedGraph(): Promise<any | null>
    {
        return FakeClient.Take(this.loaded)
    }

    public async DisposeAsync(): Promise<void>
    {
        this.Closed++
        if (this.DisposeFails) throw new Error('dispose failed')
    }

    public CloseCode(): number | undefined
    {
        return undefined
    }

    private static Take<T>(value: Read<T>): T
    {
        if (value instanceof Error) throw value
        return value
    }
}

class FakeRelay implements IRelayConnector
{
    public Connects: Array<{ target: TargetRef; action: RelayAction }> = []

    constructor(private readonly client: FakeClient | Error)
    {
    }

    public async Connect(target: TargetRef, action: RelayAction): Promise<RelayClient>
    {
        this.Connects.push({ target, action })
        if (this.client instanceof Error) throw this.client
        return this.client as unknown as RelayClient
    }
}

class Fixture
{
    public static readonly Dev: TargetRef = { Name: 'dev', Source: TargetSource.Console }

    public static NotServed(): ResponseError<void>
    {
        return new ResponseError(ErrorCodes.MethodNotFound, 'Unhandled method')
    }

    public static async Message(promise: Promise<unknown>): Promise<string>
    {
        try
        {
            await promise
        }
        catch (e)
        {
            return (e as Error).message
        }
        throw new Error('expected rejection')
    }
}

describe('EnvironmentContentsService', () =>
{
    it('merges applications and named graphs over an inspect relay', async () =>
    {
        const client = new FakeClient([{ name: 'northwind', version: '1.0.0' }], [{ name: 'sales', description: '', packageCount: 3, createdAt: '' }], null)
        const relay = new FakeRelay(client)
        const result = await new EnvironmentContentsService(relay).Contents(Fixture.Dev)
        expect(result).toEqual({ Applications: [{ Name: 'northwind', Version: '1.0.0' }], Graphs: [{ Name: 'sales', PackageCount: 3 }] })
        expect(relay.Connects).toEqual([{ target: Fixture.Dev, action: RelayAction.Inspect }])
        expect(client.Closed).toBe(1)
    })

    it('lists the loaded graph when named graphs are not served', async () =>
    {
        const client = new FakeClient([], Fixture.NotServed(), { name: 'promoted', packages: [{ id: 'a', version: '1' }], promotedAt: '' })
        expect(await new EnvironmentContentsService(new FakeRelay(client)).Contents(Fixture.Dev)).toEqual({ Applications: [], Graphs: [{ Name: 'promoted', PackageCount: 1 }] })
    })

    it('tolerates an unserved application list while graphs still list', async () =>
    {
        const client = new FakeClient(Fixture.NotServed(), [{ name: 'sales', description: '', packageCount: 2, createdAt: '' }])
        expect(await new EnvironmentContentsService(new FakeRelay(client)).Contents(Fixture.Dev)).toEqual({ Applications: [], Graphs: [{ Name: 'sales', PackageCount: 2 }] })
    })

    it('de-dupes graphs by name keeping the named graph first', async () =>
    {
        const client = new FakeClient([], [{ name: 'g', description: '', packageCount: 5, createdAt: '' }], { name: 'g', packages: [{ id: 'a', version: '1' }], promotedAt: '' })
        expect((await new EnvironmentContentsService(new FakeRelay(client)).Contents(Fixture.Dev)).Graphs).toEqual([{ Name: 'g', PackageCount: 5 }])
    })

    it('does not tolerate a ResponseError other than method-not-found', async () =>
    {
        const client = new FakeClient([], new ResponseError(ErrorCodes.InternalError, 'boom'))
        const message = await Fixture.Message(new EnvironmentContentsService(new FakeRelay(client)).Contents(Fixture.Dev))
        expect(message).toBe('boom')
        expect(client.Closed).toBe(1)
    })

    it('keeps the result when closing the client throws', async () =>
    {
        const client = new FakeClient([{ name: 'a', version: '1' }])
        client.DisposeFails = true
        expect(await new EnvironmentContentsService(new FakeRelay(client)).Contents(Fixture.Dev)).toEqual({ Applications: [{ Name: 'a', Version: '1' }], Graphs: [] })
        expect(client.Closed).toBe(1)
    })

    it('answers empty lists for an empty environment', async () =>
    {
        expect(await new EnvironmentContentsService(new FakeRelay(new FakeClient())).Contents(Fixture.Dev)).toEqual({ Applications: [], Graphs: [] })
    })

    it('closes the client and surfaces the sentence when a read drops', async () =>
    {
        const client = new FakeClient(new ConnectionLostError())
        expect(await Fixture.Message(new EnvironmentContentsService(new FakeRelay(client)).Contents(Fixture.Dev))).toBe('The environment dev could not be reached.')
        expect(client.Closed).toBe(1)
    })

    it('surfaces a connect failure as its own message', async () =>
    {
        const relay = new FakeRelay(new Error('The environment dev is not running. Start it from the tenant console.'))
        expect(await Fixture.Message(new EnvironmentContentsService(relay).Contents(Fixture.Dev))).toBe('The environment dev is not running. Start it from the tenant console.')
    })
})
