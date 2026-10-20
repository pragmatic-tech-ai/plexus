import { describe, expect, it } from 'vitest'
import type { ContributedPackageDto, GraphContributeParamsDto, GraphDetailDto } from '@pragmatic-tech-ai/pragmatic-protocol'
import { GraphContributeService } from '../graph-contribute-service.js'
import type { IGraphClientFactory, IGraphContributeClient } from '../graph-client.js'
import type { GraphProfile, IGraphProfileSource } from '../graph-profile.js'

const Token = 'SECRET-TOKEN-xyz'
const Url = 'https://graph.example.com'

class FakeProfiles implements IGraphProfileSource
{
    constructor(private readonly profile: GraphProfile | undefined)
    {
    }

    public async Load(): Promise<GraphProfile | undefined>
    {
        return this.profile
    }
}

class FakeClient implements IGraphContributeClient
{
    public Calls: GraphContributeParamsDto[] = []
    public Closed = 0

    constructor(private readonly outcome: GraphDetailDto | Error)
    {
    }

    public async ContributeGraph(params: GraphContributeParamsDto): Promise<GraphDetailDto>
    {
        this.Calls.push(params)
        if (this.outcome instanceof Error) throw this.outcome
        return this.outcome
    }

    public async Close(): Promise<void>
    {
        this.Closed++
    }
}

class FakeFactory implements IGraphClientFactory
{
    public Connects: { url: string; token: string }[] = []

    constructor(private readonly client: FakeClient | Error)
    {
    }

    public async Connect(serverUrl: string, token: string): Promise<IGraphContributeClient>
    {
        this.Connects.push({ url: serverUrl, token })
        if (this.client instanceof Error) throw this.client
        return this.client
    }
}

class Fixture
{
    public static readonly Profile: GraphProfile = { ServerUrl: Url, Token: Token }
    public static readonly Packages: ContributedPackageDto[] = [{ id: 'a', version: '1.0.0', modelJson: '{}' }]
    public static readonly Detail: GraphDetailDto = { name: 'g1', description: '', packages: [{ id: 'a', version: '1.0.0' }, { id: 'b', version: '2.0.0' }], createdAt: '' }

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
    it('throws NoProfile and never connects when no profile is stored', async () =>
    {
        const factory = new FakeFactory(new FakeClient(Fixture.Detail))
        const svc = new GraphContributeService(new FakeProfiles(undefined), factory)
        const msg = await Fixture.Message(svc.Contribute('g1', 's1', Fixture.Packages))
        expect(msg).toContain('No graph server is configured')
        expect(factory.Connects).toHaveLength(0)
    })

    it('connects once, contributes, maps the result and closes', async () =>
    {
        const client = new FakeClient(Fixture.Detail)
        const factory = new FakeFactory(client)
        const svc = new GraphContributeService(new FakeProfiles(Fixture.Profile), factory)
        const result = await svc.Contribute('g1', 's1', Fixture.Packages)
        expect(result).toEqual({ GraphName: 'g1', PackageCount: 2 })
        expect(factory.Connects).toEqual([{ url: Url, token: Token }])
        expect(client.Calls).toEqual([{ graphName: 'g1', solutionId: 's1', packages: Fixture.Packages }])
        expect(client.Closed).toBe(1)
    })

    it('closes the client when ContributeGraph rejects', async () =>
    {
        const client = new FakeClient(new Error('boom'))
        const svc = new GraphContributeService(new FakeProfiles(Fixture.Profile), new FakeFactory(client))
        await Fixture.Message(svc.Contribute('g1', 's1', Fixture.Packages))
        expect(client.Closed).toBe(1)
    })

    it('wraps a connect failure with the URL only, never the token or detail', async () =>
    {
        const svc = new GraphContributeService(new FakeProfiles(Fixture.Profile), new FakeFactory(new Error(`auth failed for ${Token}`)))
        const msg = await Fixture.Message(svc.Contribute('g1', 's1', Fixture.Packages))
        expect(msg).toContain(Url)
        expect(msg).not.toContain(Token)
        expect(msg).not.toContain('auth failed')
    })

    it('propagates distinct server rejections unchanged and closes', async () =>
    {
        const conflict = new FakeClient(new Error('Graph g1 conflicts with existing contribution'))
        const missing = new FakeClient(new Error('Solution s1 not found'))
        const m1 = await Fixture.Message(new GraphContributeService(new FakeProfiles(Fixture.Profile), new FakeFactory(conflict)).Contribute('g1', 's1', Fixture.Packages))
        const m2 = await Fixture.Message(new GraphContributeService(new FakeProfiles(Fixture.Profile), new FakeFactory(missing)).Contribute('g1', 's1', Fixture.Packages))
        expect(m1).toContain('conflicts')
        expect(m2).toContain('not found')
        expect(m1).not.toBe(m2)
        expect(conflict.Closed).toBe(1)
        expect(missing.Closed).toBe(1)
        expect(m1).not.toContain(Token)
        expect(m2).not.toContain(Token)
    })
})
