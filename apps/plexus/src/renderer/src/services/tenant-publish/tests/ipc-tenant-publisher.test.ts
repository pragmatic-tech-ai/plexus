import { afterEach, describe, expect, it } from 'vitest'
import IpcTenantPublisher from '../ipc-tenant-publisher.js'

class FakeTenantPublish
{
    public readonly Calls: unknown[][] = []
    public Reply: unknown = { Ok: true, Value: { Status: 'applied', AppName: 'orders', AppVersion: '1' } }

    public Deploy(environment: string, outputDir: string): Promise<unknown>
    {
        this.Calls.push([environment, outputDir])
        return Promise.resolve(this.Reply)
    }
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

    it('forwards Publish with the environment and unwraps the result', async () =>
    {
        const fake = new FakeTenantPublish();
        (globalThis as any).api = { tenantPublish: fake }
        expect(await new IpcTenantPublisher().Publish('prod', '/p/build-remote')).toEqual({ Status: 'applied', AppName: 'orders', AppVersion: '1' })
        expect(fake.Calls).toEqual([['prod', '/p/build-remote']])
    })

    it('rejects with the failure sentence', async () =>
    {
        const fake = new FakeTenantPublish();
        (globalThis as any).api = { tenantPublish: fake }
        fake.Reply = { Ok: false, Error: { Message: "Your account can't use this environment." } }
        await expect(new IpcTenantPublisher().Publish('prod', '/p/build-remote')).rejects.toThrow("Your account can't use this environment.")
    })
})
