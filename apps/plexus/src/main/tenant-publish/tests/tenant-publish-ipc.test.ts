import { describe, it, expect } from 'vitest'
import type { IpcMain } from 'electron'
import { TenantPublishStatus, type TenantPublishResult } from '@pragmatic-tech-ai/plexus-core/shared/tenant-publish-api.js'
import { TargetSource, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { TenantPublishIpc } from '../tenant-publish-ipc.js'
import { TenantPublishChannel } from '../../../shared/tenant-publish-api.js'
import type { TenantDeployService } from '../tenant-deploy-service.js'

type Handler = (event: unknown, ...args: any[]) => unknown

class FakeIpc
{
    public readonly Handlers = new Map<string, Handler>()
    public handle(channel: string, handler: Handler): void
    {
        this.Handlers.set(channel, handler)
    }
}

class FakeDeploy
{
    public Calls: unknown[][] = []
    public Failure: Error | undefined

    public async Deploy(target: TargetRef, outputDir: string): Promise<TenantPublishResult>
    {
        this.Calls.push([target, outputDir])
        if (this.Failure !== undefined) throw this.Failure
        return { Status: TenantPublishStatus.Applied, AppName: 'orders', AppVersion: '1' }
    }
}

class Harness
{
    public readonly Ipc = new FakeIpc()
    public readonly Deploy = new FakeDeploy()

    public constructor()
    {
        TenantPublishIpc.Register(this.Ipc as unknown as IpcMain, this.Deploy as unknown as TenantDeployService)
    }

    public Invoke(...args: unknown[]): Promise<any>
    {
        return Promise.resolve(this.Ipc.Handlers.get(TenantPublishChannel.Deploy)!({}, ...args))
    }
}

describe('TenantPublishIpc', () =>
{
    it('binds only the deploy channel', () =>
    {
        const h = new Harness()
        expect(Object.values(TenantPublishChannel)).toEqual(['tenant-publish:deploy'])
        expect([...h.Ipc.Handlers.keys()]).toEqual(['tenant-publish:deploy'])
    })

    const Prod: TargetRef = { Name: 'prod', Source: TargetSource.Console }
    const Malformed = { Ok: false, Error: { Message: 'The publish request was malformed.' } }

    it('Deploy delegates with the target and answers an Ok envelope', async () =>
    {
        const h = new Harness()
        expect(await h.Invoke(Prod, '/p/build-remote')).toEqual({ Ok: true, Value: { Status: TenantPublishStatus.Applied, AppName: 'orders', AppVersion: '1' } })
        expect(h.Deploy.Calls).toEqual([[Prod, '/p/build-remote']])
    })

    it('hands the service only Name and Source of the target', async () =>
    {
        const h = new Harness()
        await h.Invoke({ Name: 'prod', Source: 'platform', Token: 'secret' }, '/p/build-remote')
        expect(h.Deploy.Calls[0]![0]).toStrictEqual({ Name: 'prod', Source: TargetSource.Platform })
    })

    it('answers a failure as its sentence', async () =>
    {
        const h = new Harness()
        h.Deploy.Failure = new Error("Your account can't use this environment.")
        expect(await h.Invoke(Prod, '/p/build-remote')).toEqual({ Ok: false, Error: { Message: "Your account can't use this environment." } })
    })

    it('refuses an unknown source, a bare environment name and other malformed arguments before the service', async () =>
    {
        const h = new Harness()
        expect(await h.Invoke({ Name: 'prod', Source: 'x' }, '/p/build-remote')).toEqual(Malformed)
        expect(await h.Invoke('prod', '/p/build-remote')).toEqual(Malformed)
        expect(await h.Invoke({ Name: ' ', Source: 'console' }, '/p/build-remote')).toEqual(Malformed)
        expect(await h.Invoke(Prod, 3)).toEqual(Malformed)
        expect(h.Deploy.Calls).toEqual([])
    })
})
