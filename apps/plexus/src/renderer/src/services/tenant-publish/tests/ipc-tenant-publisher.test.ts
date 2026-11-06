import { afterEach, describe, expect, it } from 'vitest'
import { TargetSource, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import IpcTenantPublisher from '../ipc-tenant-publisher.js'

class FakeTenantPublish
{
    public readonly Calls: unknown[][] = []
    public Reply: unknown = { Ok: true, Value: { Status: 'applied', AppName: 'orders', AppVersion: '1' } }

    public Deploy(target: TargetRef, outputDir: string): Promise<unknown>
    {
        this.Calls.push([target, outputDir])
        return Promise.resolve(this.Reply)
    }
}

class Targets
{
    public static readonly Prod: TargetRef = { Name: 'prod', Source: TargetSource.Console }
    // A ref that carries more than Name and Source (an EnvironmentTarget is one structurally).
    public static readonly PlatformTarget = { Id: 'platform:prod', Name: 'prod', Status: 'running', Source: TargetSource.Platform } as TargetRef
    public static readonly PlatformRef: TargetRef = { Name: 'prod', Source: TargetSource.Platform }
}

describe('IpcTenantPublisher', () =>
{
    afterEach(() =>
    {
        delete (globalThis as any).api
    })

    it('throws when the bridge is unavailable', () =>
    {
        (globalThis as any).api = {}
        expect(() => new IpcTenantPublisher()).toThrow(/tenantPublish is unavailable/)
    })

    it('forwards Publish with the target and unwraps the result', async () =>
    {
        const fake = new FakeTenantPublish();
        (globalThis as any).api = { tenantPublish: fake }
        expect(await new IpcTenantPublisher().Publish(Targets.Prod, '/p/build-remote')).toEqual({ Status: 'applied', AppName: 'orders', AppVersion: '1' })
        expect(fake.Calls).toEqual([[Targets.Prod, '/p/build-remote']])
    })

    it('sends only Name and Source across the bridge', async () =>
    {
        const fake = new FakeTenantPublish();
        (globalThis as any).api = { tenantPublish: fake }
        await new IpcTenantPublisher().Publish(Targets.PlatformTarget, '/p/build-remote')
        expect(fake.Calls[0]![0]).toStrictEqual(Targets.PlatformRef)
    })

    it('rejects with the failure sentence', async () =>
    {
        const fake = new FakeTenantPublish();
        (globalThis as any).api = { tenantPublish: fake }
        fake.Reply = { Ok: false, Error: { Message: "Your account can't use this environment." } }
        await expect(new IpcTenantPublisher().Publish(Targets.Prod, '/p/build-remote')).rejects.toThrow("Your account can't use this environment.")
    })
})
