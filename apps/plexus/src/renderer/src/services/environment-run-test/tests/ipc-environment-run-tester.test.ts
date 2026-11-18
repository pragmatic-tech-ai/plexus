import { afterEach, describe, expect, it } from 'vitest'
import { TargetSource, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import IpcEnvironmentRunTester from '../ipc-environment-run-tester.js'

class FakeRunTest
{
    public readonly Calls: unknown[][] = []
    public Reply: unknown = { Ok: true, Value: { Status: 'applied', AppName: 'orders', AppVersion: '1', AppUrl: 'https://c.test/app/dev/orders/' } }

    public Run(target: TargetRef, outputDir: string): Promise<unknown>
    {
        this.Calls.push([target, outputDir])
        return Promise.resolve(this.Reply)
    }
}

describe('IpcEnvironmentRunTester', () =>
{
    afterEach(() =>
    {
        delete (globalThis as any).api
    })

    it('throws when the bridge is unavailable', () =>
    {
        (globalThis as any).api = {}
        expect(() => new IpcEnvironmentRunTester()).toThrow(/runTest is unavailable/)
    })

    it('forwards Run with only Name and Source and unwraps the result', async () =>
    {
        const fake = new FakeRunTest();
        (globalThis as any).api = { runTest: fake }
        const target = { Name: 'dev', Source: TargetSource.Console, Status: 'running' } as unknown as TargetRef
        const result = await new IpcEnvironmentRunTester().Run(target, '/p/build-remote')
        expect(fake.Calls).toEqual([[{ Name: 'dev', Source: TargetSource.Console }, '/p/build-remote']])
        expect(result.AppUrl).toBe('https://c.test/app/dev/orders/')
    })

    it('rejects with the failure sentence', async () =>
    {
        const fake = new FakeRunTest()
        fake.Reply = { Ok: false, Error: { Message: 'Nope.' } };
        (globalThis as any).api = { runTest: fake }
        await expect(new IpcEnvironmentRunTester().Run({ Name: 'dev', Source: TargetSource.Console }, '/p')).rejects.toThrow('Nope.')
    })
})
