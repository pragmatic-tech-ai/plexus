import { afterEach, describe, expect, it } from 'vitest'
import { TargetSource, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { EnvironmentsContentsSource } from '../environments-contents-source.js'

class FakeBridge
{
    public readonly Calls: TargetRef[] = []
    public Reply: unknown = { Ok: true, Value: { Applications: [{ Name: 'a', Version: '1' }], Graphs: [] } }

    public Contents(t: TargetRef): Promise<unknown>
    {
        this.Calls.push(t)
        return Promise.resolve(this.Reply)
    }
}

class Targets
{
    public static readonly Dev: TargetRef = { Name: 'dev', Source: TargetSource.Console }
    public static readonly Wide = { Id: 'platform:dev', Name: 'dev', Status: 'running', Source: TargetSource.Platform } as TargetRef
    public static readonly PlatformRef: TargetRef = { Name: 'dev', Source: TargetSource.Platform }
}

describe('EnvironmentsContentsSource', () =>
{
    afterEach(() =>
    {
        delete (globalThis as any).api
    })

    it('throws when the bridge is unavailable', () =>
    {
        (globalThis as any).api = {}
        expect(() => new EnvironmentsContentsSource()).toThrow(/environments is unavailable/)
        delete (globalThis as any).api
        expect(() => new EnvironmentsContentsSource()).toThrow(/environments is unavailable/)
    })

    it('unwraps an Ok reply', async () =>
    {
        const fake = new FakeBridge();
        (globalThis as any).api = { environments: fake }
        const result = await new EnvironmentsContentsSource().Contents(Targets.Dev)
        expect(result.Applications).toEqual([{ Name: 'a', Version: '1' }])
    })

    it('rejects with the failure sentence', async () =>
    {
        const fake = new FakeBridge();
        (globalThis as any).api = { environments: fake }
        fake.Reply = { Ok: false, Error: { Message: 'The environment dev is not running.' } }
        await expect(new EnvironmentsContentsSource().Contents(Targets.Dev)).rejects.toThrow('The environment dev is not running.')
    })

    it('sends only Name and Source across the bridge', async () =>
    {
        const fake = new FakeBridge();
        (globalThis as any).api = { environments: fake }
        await new EnvironmentsContentsSource().Contents(Targets.Wide)
        expect(fake.Calls).toStrictEqual([Targets.PlatformRef])
    })
})
