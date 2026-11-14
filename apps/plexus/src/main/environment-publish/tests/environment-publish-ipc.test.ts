import { describe, it, expect } from 'vitest'
import type { IpcMain } from 'electron'
import { EnvironmentPublishStatus, type EnvironmentPublishResult } from '@pragmatic-tech-ai/plexus-core/shared/environment-publish-api.js'
import { TargetSource, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { EnvironmentPublishIpc } from '../environment-publish-ipc.js'
import { EnvironmentPublishChannel } from '../../../shared/environment-publish-api.js'
import type { EnvironmentDeployService } from '../environment-deploy-service.js'

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

    public async Deploy(target: TargetRef, outputDir: string): Promise<EnvironmentPublishResult>
    {
        this.Calls.push([target, outputDir])
        if (this.Failure !== undefined) throw this.Failure
        return { Status: EnvironmentPublishStatus.Applied, AppName: 'orders', AppVersion: '1' }
    }
}

class Harness
{
    public readonly Ipc = new FakeIpc()
    public readonly Deploy = new FakeDeploy()

    public constructor()
    {
        EnvironmentPublishIpc.Register(this.Ipc as unknown as IpcMain, this.Deploy as unknown as EnvironmentDeployService)
    }

    public Invoke(...args: unknown[]): Promise<any>
    {
        return Promise.resolve(this.Ipc.Handlers.get(EnvironmentPublishChannel.Deploy)!({}, ...args))
    }
}

describe('EnvironmentPublishIpc', () =>
{
    it('binds only the deploy channel', () =>
    {
        const h = new Harness()
        expect(Object.values(EnvironmentPublishChannel)).toEqual(['environment-publish:deploy'])
        expect([...h.Ipc.Handlers.keys()]).toEqual(['environment-publish:deploy'])
    })

    const Prod: TargetRef = { Name: 'prod', Source: TargetSource.Console }
    const Malformed = { Ok: false, Error: { Message: 'The publish request was malformed.' } }

    it('Deploy delegates with the target and answers an Ok envelope', async () =>
    {
        const h = new Harness()
        expect(await h.Invoke(Prod, '/p/build-remote')).toEqual({ Ok: true, Value: { Status: EnvironmentPublishStatus.Applied, AppName: 'orders', AppVersion: '1' } })
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
