import { describe, it, expect } from 'vitest'
import type { IpcMain } from 'electron'
import { AccountError, AccountErrorKind } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { GraphContributeIpc } from '../graph-contribute-ipc.js'
import { GraphContributeChannel, type ContributedPackage, type GraphContributeResult } from '../../../shared/graph-contribute-api.js'
import type { GraphContributeService } from '../graph-contribute-service.js'

type Handler = (event: unknown, ...args: any[]) => unknown

class FakeIpc
{
    public readonly Handlers = new Map<string, Handler>()
    public handle(channel: string, handler: Handler): void
    {
        this.Handlers.set(channel, handler)
    }
}

class FakeService
{
    public Calls: unknown[][] = []
    public Failure: Error | undefined

    public async Contribute(environment: string, graphName: string, solutionId: string, packages: readonly ContributedPackage[]): Promise<GraphContributeResult>
    {
        this.Calls.push([environment, graphName, solutionId, packages])
        if (this.Failure !== undefined) throw this.Failure
        return { GraphName: graphName, PackageCount: packages.length }
    }

    public async ListGraphs(environment: string): Promise<string[]>
    {
        this.Calls.push([environment])
        if (this.Failure !== undefined) throw this.Failure
        return ['main']
    }
}

class Harness
{
    public readonly Ipc = new FakeIpc()
    public readonly Service = new FakeService()

    public constructor()
    {
        GraphContributeIpc.Register(this.Ipc as unknown as IpcMain, this.Service as unknown as GraphContributeService)
    }

    public Invoke(channel: GraphContributeChannel, ...args: unknown[]): Promise<any>
    {
        return Promise.resolve(this.Ipc.Handlers.get(channel)!({}, ...args))
    }
}

describe('GraphContributeIpc', () =>
{
    const Packages: ContributedPackage[] = [{ id: 'p', version: '1.0.0', modelJson: '{}' }]

    it('binds exactly the contribute and list-graphs channels', () =>
    {
        const h = new Harness()
        expect(Object.values(GraphContributeChannel).sort()).toEqual(['graph-contribute:contribute', 'graph-contribute:list-graphs'])
        expect([...h.Ipc.Handlers.keys()].sort()).toEqual(Object.values(GraphContributeChannel).sort())
    })

    it('Contribute delegates with the environment and answers an Ok envelope', async () =>
    {
        const h = new Harness()
        const reply = await h.Invoke(GraphContributeChannel.Contribute, 'dev', 'g', 's', Packages)
        expect(h.Service.Calls).toEqual([['dev', 'g', 's', Packages]])
        expect(reply).toEqual({ Ok: true, Value: { GraphName: 'g', PackageCount: 1 } })
    })

    it('ListGraphs delegates with the environment', async () =>
    {
        const h = new Harness()
        expect(await h.Invoke(GraphContributeChannel.ListGraphs, 'dev')).toEqual({ Ok: true, Value: ['main'] })
        expect(h.Service.Calls).toEqual([['dev']])
    })

    it('answers a failure as its sentence, keeping the account kind', async () =>
    {
        const h = new Harness()
        h.Service.Failure = new Error('The environment dev is not running. Start it from the tenant console.')
        expect(await h.Invoke(GraphContributeChannel.ListGraphs, 'dev')).toEqual({ Ok: false, Error: { Message: 'The environment dev is not running. Start it from the tenant console.' } })
        h.Service.Failure = new AccountError(AccountErrorKind.SignedOut)
        expect(await h.Invoke(GraphContributeChannel.Contribute, 'dev', 'g', 's', Packages)).toEqual({ Ok: false, Error: { Message: "You're signed out. Sign in and try again.", Kind: AccountErrorKind.SignedOut } })
    })

    it('refuses malformed arguments before the service', async () =>
    {
        const h = new Harness()
        const bad = [
            await h.Invoke(GraphContributeChannel.Contribute, '', 'g', 's', Packages),
            await h.Invoke(GraphContributeChannel.Contribute, 'dev', 7, 's', Packages),
            await h.Invoke(GraphContributeChannel.Contribute, 'dev', 'g', 's', 'nope'),
            await h.Invoke(GraphContributeChannel.ListGraphs, undefined),
        ]
        for (const reply of bad) expect(reply.Ok).toBe(false)
        expect(h.Service.Calls).toEqual([])
    })
})
