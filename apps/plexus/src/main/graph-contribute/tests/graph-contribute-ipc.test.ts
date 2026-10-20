import { describe, it, expect } from 'vitest'
import type { IpcMain } from 'electron'
import { GraphContributeIpc } from '../graph-contribute-ipc.js'
import { GraphContributeChannel, type ContributedPackage, type GraphContributeResult } from '../../../shared/graph-contribute-api.js'
import type { GraphContributeService } from '../graph-contribute-service.js'
import type { GraphProfileStore } from '../graph-profile-store.js'

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
    public async Contribute(graphName: string, solutionId: string, packages: readonly ContributedPackage[]): Promise<GraphContributeResult>
    {
        this.Calls.push([graphName, solutionId, packages])
        return { GraphName: graphName, PackageCount: packages.length }
    }
}

class FakeProfiles
{
    public Saved: unknown[][] = []
    public Stored: { ServerUrl: string; Token: string } | undefined
    public async Save(serverUrl: string, token: string): Promise<void>
    {
        this.Saved.push([serverUrl, token])
    }
    public async Load(): Promise<{ ServerUrl: string; Token: string } | undefined>
    {
        return this.Stored
    }
}

class Harness
{
    public readonly Ipc = new FakeIpc()
    public readonly Service = new FakeService()
    public readonly Profiles = new FakeProfiles()

    public constructor()
    {
        GraphContributeIpc.Register(this.Ipc as unknown as IpcMain, this.Service as unknown as GraphContributeService, this.Profiles as unknown as GraphProfileStore)
    }

    public Invoke(channel: GraphContributeChannel, ...args: unknown[]): unknown
    {
        return this.Ipc.Handlers.get(channel)!({}, ...args)
    }
}

describe('GraphContributeIpc', () =>
{
    it('binds all three channels', () =>
    {
        const h = new Harness()
        for (const channel of Object.values(GraphContributeChannel))
        {
            expect(h.Ipc.Handlers.has(channel)).toBe(true)
        }
    })

    it('Contribute delegates to the service and returns its result', async () =>
    {
        const h = new Harness()
        const packages: ContributedPackage[] = [{ id: 'p', version: '1.0.0', modelJson: '{}' }]
        const result = await h.Invoke(GraphContributeChannel.Contribute, 'g', 's', packages)
        expect(h.Service.Calls).toEqual([['g', 's', packages]])
        expect(result).toEqual({ GraphName: 'g', PackageCount: 1 })
    })

    it('SetProfile delegates to profiles.Save', async () =>
    {
        const h = new Harness()
        await h.Invoke(GraphContributeChannel.SetProfile, 'wss://x', 'tok')
        expect(h.Profiles.Saved).toEqual([['wss://x', 'tok']])
    })

    it('HasProfile returns only a boolean, never the token', async () =>
    {
        const h = new Harness()
        expect(await h.Invoke(GraphContributeChannel.HasProfile)).toBe(false)
        h.Profiles.Stored = { ServerUrl: 'wss://x', Token: 'secret' }
        const has = await h.Invoke(GraphContributeChannel.HasProfile)
        expect(has).toBe(true)
        expect(typeof has).toBe('boolean')
    })
})
