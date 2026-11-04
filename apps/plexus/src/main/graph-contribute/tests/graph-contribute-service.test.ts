import { describe, expect, it } from 'vitest'
import { ConnectionLostError, ResponseError } from '@pragmatic-tech-ai/pragmatic-protocol'
import type { ContributedPackageDto, GraphContributeParamsDto, GraphDetailDto, GraphSummaryDto } from '@pragmatic-tech-ai/pragmatic-protocol'
import { TargetKind } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { GraphContributeService } from '../graph-contribute-service.js'
import type { IRelayConnector, RelayClient } from '../../account/relay-connector.js'

class FakeClient
{
    public Calls: GraphContributeParamsDto[] = []
    public Closed = 0

    constructor(private readonly outcome: GraphDetailDto | Error, private readonly graphs: GraphSummaryDto[] = [])
    {
    }

    public async ContributeGraph(params: GraphContributeParamsDto): Promise<GraphDetailDto>
    {
        this.Calls.push(params)
        if (this.outcome instanceof Error) throw this.outcome
        return this.outcome
    }

    public async ListGraphs(): Promise<GraphSummaryDto[]>
    {
        if (this.outcome instanceof Error) throw this.outcome
        return this.graphs
    }

    public async DisposeAsync(): Promise<void>
    {
        this.Closed++
    }
}

class FakeRelay implements IRelayConnector
{
    public Connects: Array<{ environment: string; kind: TargetKind }> = []

    constructor(private readonly client: FakeClient | Error)
    {
    }

    public async Connect(environment: string, kind: TargetKind): Promise<RelayClient>
    {
        this.Connects.push({ environment, kind })
        if (this.client instanceof Error) throw this.client
        return this.client as unknown as RelayClient
    }
}

class Fixture
{
    public static readonly Packages: ContributedPackageDto[] = [{ id: 'a', version: '1.0.0', modelJson: '{}' }]
    public static readonly Detail: GraphDetailDto = { name: 'g1', description: '', packages: [{ id: 'a', version: '1.0.0' }, { id: 'b', version: '2.0.0' }], createdAt: '' }

    public static Summary(name: string): GraphSummaryDto
    {
        return { name, description: '', packageCount: 0, createdAt: '' }
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

describe('GraphContributeService', () =>
{
    it('contributes through a contribute relay to the environment, maps the result and closes', async () =>
    {
        const client = new FakeClient(Fixture.Detail)
        const relay = new FakeRelay(client)
        const result = await new GraphContributeService(relay).Contribute('dev', 'g1', 's1', Fixture.Packages)
        expect(result).toEqual({ GraphName: 'g1', PackageCount: 2 })
        expect(relay.Connects).toEqual([{ environment: 'dev', kind: TargetKind.Contribute }])
        expect(client.Calls).toEqual([{ graphName: 'g1', solutionId: 's1', packages: Fixture.Packages }])
        expect(client.Closed).toBe(1)
    })

    it('closes the client when ContributeGraph rejects and propagates the server message', async () =>
    {
        const client = new FakeClient(new Error('Graph g1 conflicts with existing contribution'))
        const msg = await Fixture.Message(new GraphContributeService(new FakeRelay(client)).Contribute('dev', 'g1', 's1', Fixture.Packages))
        expect(msg).toContain('conflicts')
        expect(client.Closed).toBe(1)
    })

    it('maps a relay that drops mid-call to the unreachable sentence and closes', async () =>
    {
        const lost = new FakeClient(new ConnectionLostError())
        const disposed = new FakeClient(Object.assign(new Error('Connection is disposed.'), { code: 2 }))
        expect(await Fixture.Message(new GraphContributeService(new FakeRelay(lost)).Contribute('dev', 'g1', 's1', Fixture.Packages))).toBe('The environment dev could not be reached.')
        expect(await Fixture.Message(new GraphContributeService(new FakeRelay(disposed)).ListGraphs('dev'))).toBe('The environment dev could not be reached.')
        expect(lost.Closed).toBe(1)
        expect(disposed.Closed).toBe(1)
    })

    it('keeps a server JSON-RPC error message as it is', async () =>
    {
        const client = new FakeClient(new ResponseError(-32004, 'Solution s1 not found'))
        expect(await Fixture.Message(new GraphContributeService(new FakeRelay(client)).Contribute('dev', 'g1', 's1', Fixture.Packages))).toBe('Solution s1 not found')
    })

    it('propagates the relay refusal sentence unchanged', async () =>
    {
        const msg = await Fixture.Message(new GraphContributeService(new FakeRelay(new Error("Your account can't use this environment."))).Contribute('dev', 'g1', 's1', Fixture.Packages))
        expect(msg).toBe("Your account can't use this environment.")
    })

    it('ListGraphs returns the graph names sorted and closes the client', async () =>
    {
        const client = new FakeClient(Fixture.Detail, [Fixture.Summary('zeta'), Fixture.Summary('alpha'), Fixture.Summary('main')])
        const relay = new FakeRelay(client)
        const names = await new GraphContributeService(relay).ListGraphs('dev')
        expect(names).toEqual(['alpha', 'main', 'zeta'])
        expect(relay.Connects).toEqual([{ environment: 'dev', kind: TargetKind.Contribute }])
        expect(client.Closed).toBe(1)
    })

    it('ListGraphs closes the client on failure', async () =>
    {
        const client = new FakeClient(new Error('boom'))
        await Fixture.Message(new GraphContributeService(new FakeRelay(client)).ListGraphs('dev'))
        expect(client.Closed).toBe(1)
    })
})
