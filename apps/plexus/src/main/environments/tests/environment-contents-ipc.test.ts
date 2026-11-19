import { describe, it, expect } from 'vitest'
import type { IpcMain } from 'electron'
import { TargetSource, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { EnvironmentContentsIpc } from '../environment-contents-ipc.js'
import { EnvironmentsChannel, type EnvironmentContents } from '../../../shared/environment-contents-api.js'
import type { EnvironmentContentsService } from '../environment-contents-service.js'

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
    public Calls: TargetRef[] = []

    public async Contents(target: TargetRef): Promise<EnvironmentContents>
    {
        this.Calls.push(target)
        return { Applications: [], Graphs: [] }
    }
}

class Harness
{
    public readonly Ipc = new FakeIpc()
    public readonly Service = new FakeService()

    constructor()
    {
        EnvironmentContentsIpc.Register(this.Ipc as unknown as IpcMain, this.Service as unknown as EnvironmentContentsService)
    }

    public Invoke(...args: unknown[]): Promise<any>
    {
        return Promise.resolve(this.Ipc.Handlers.get(EnvironmentsChannel.Contents)!({}, ...args))
    }
}

describe('EnvironmentContentsIpc', () =>
{
    it('binds the contents and cypher channels', () =>
    {
        expect([...new Harness().Ipc.Handlers.keys()]).toEqual(['environments:contents', 'environments:cypher'])
    })

    it('passes only the rebuilt Name and Source', async () =>
    {
        const h = new Harness()
        const reply = await h.Invoke({ Name: 'dev', Source: 'platform', Token: 'secret' })
        expect(reply).toEqual({ Ok: true, Value: { Applications: [], Graphs: [] } })
        expect(h.Service.Calls[0]).toStrictEqual({ Name: 'dev', Source: TargetSource.Platform })
    })

    it('refuses a malformed target before the service', async () =>
    {
        const h = new Harness()
        const bad = { Ok: false, Error: { Message: 'The environment request was malformed.' } }
        expect(await h.Invoke('dev')).toEqual(bad)
        expect(await h.Invoke({ Name: 'dev', Source: 'x' })).toEqual(bad)
        expect(h.Service.Calls).toEqual([])
    })
})
