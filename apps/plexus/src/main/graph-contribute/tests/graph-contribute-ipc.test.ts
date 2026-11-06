import { describe, it, expect } from 'vitest'
import type { IpcMain } from 'electron'
import { AccountError, AccountErrorKind, TargetSource, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
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

    public async Contribute(target: TargetRef, graphName: string, solutionId: string, packages: readonly ContributedPackage[]): Promise<GraphContributeResult>
    {
        this.Calls.push([target, graphName, solutionId, packages])
        if (this.Failure !== undefined) throw this.Failure
        return { GraphName: graphName, PackageCount: packages.length }
    }

    public async ListGraphs(target: TargetRef): Promise<string[]>
    {
        this.Calls.push([target])
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
    const Dev: TargetRef = { Name: 'dev', Source: TargetSource.Console }
    const PlatformDev: TargetRef = { Name: 'dev', Source: TargetSource.Platform }
    const Malformed = { Ok: false, Error: { Message: 'The contribute request was malformed.' } }

    it('binds exactly the contribute and list-graphs channels', () =>
    {
        const h = new Harness()
        expect(Object.values(GraphContributeChannel).sort()).toEqual(['graph-contribute:contribute', 'graph-contribute:list-graphs'])
        expect([...h.Ipc.Handlers.keys()].sort()).toEqual(Object.values(GraphContributeChannel).sort())
    })

    it('Contribute delegates with the target and answers an Ok envelope', async () =>
    {
        const h = new Harness()
        const reply = await h.Invoke(GraphContributeChannel.Contribute, Dev, 'g', 's', Packages)
        expect(h.Service.Calls).toEqual([[Dev, 'g', 's', Packages]])
        expect(reply).toEqual({ Ok: true, Value: { GraphName: 'g', PackageCount: 1 } })
    })

    it('ListGraphs delegates with the target', async () =>
    {
        const h = new Harness()
        expect(await h.Invoke(GraphContributeChannel.ListGraphs, PlatformDev)).toEqual({ Ok: true, Value: ['main'] })
        expect(h.Service.Calls).toEqual([[PlatformDev]])
    })

    it('hands the service only Name and Source of the target', async () =>
    {
        const h = new Harness()
        await h.Invoke(GraphContributeChannel.ListGraphs, { Name: 'dev', Source: 'platform', Token: 'secret' })
        expect(h.Service.Calls[0]![0]).toStrictEqual(PlatformDev)
    })

    it('answers a failure as its sentence, keeping the account kind', async () =>
    {
        const h = new Harness()
        h.Service.Failure = new Error('The environment dev is not running. Start it from the tenant console.')
        expect(await h.Invoke(GraphContributeChannel.ListGraphs, Dev)).toEqual({ Ok: false, Error: { Message: 'The environment dev is not running. Start it from the tenant console.' } })
        h.Service.Failure = new AccountError(AccountErrorKind.SignedOut)
        expect(await h.Invoke(GraphContributeChannel.Contribute, Dev, 'g', 's', Packages)).toEqual({ Ok: false, Error: { Message: "You're signed out. Sign in and try again.", Kind: AccountErrorKind.SignedOut } })
    })

    it('refuses an unknown source and a bare environment name with the BadArguments sentence', async () =>
    {
        const h = new Harness()
        expect(await h.Invoke(GraphContributeChannel.Contribute, { Name: 'dev', Source: 'x' }, 'g', 's', Packages)).toEqual(Malformed)
        expect(await h.Invoke(GraphContributeChannel.Contribute, 'dev', 'g', 's', Packages)).toEqual(Malformed)
        expect(await h.Invoke(GraphContributeChannel.ListGraphs, { Name: 'dev', Source: 'x' })).toEqual(Malformed)
        expect(await h.Invoke(GraphContributeChannel.ListGraphs, 'dev')).toEqual(Malformed)
        expect(h.Service.Calls).toEqual([])
    })

    it('refuses malformed arguments before the service', async () =>
    {
        const h = new Harness()
        const bad = [
            await h.Invoke(GraphContributeChannel.Contribute, { Name: '', Source: 'console' }, 'g', 's', Packages),
            await h.Invoke(GraphContributeChannel.Contribute, Dev, 7, 's', Packages),
            await h.Invoke(GraphContributeChannel.Contribute, Dev, 'g', 's', 'nope'),
            await h.Invoke(GraphContributeChannel.ListGraphs, undefined),
            await h.Invoke(GraphContributeChannel.ListGraphs, { Source: 'console' }),
        ]
        for (const reply of bad) expect(reply).toEqual(Malformed)
        expect(h.Service.Calls).toEqual([])
    })
})
