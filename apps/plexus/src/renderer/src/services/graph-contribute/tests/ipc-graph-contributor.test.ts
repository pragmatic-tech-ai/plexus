import { afterEach, describe, expect, it } from 'vitest'
import { AccountError, AccountErrorKind, TargetSource, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import IpcGraphContributor from '../ipc-graph-contributor.js'

class FakeGraphContribute
{
    public readonly Calls: unknown[][] = []
    public Reply: unknown = { Ok: true, Value: { GraphName: 'g', PackageCount: 1 } }

    public Contribute(t: TargetRef, g: string, s: string, p: unknown[]): Promise<unknown>
    {
        this.Calls.push(['Contribute', t, g, s, p])
        return Promise.resolve(this.Reply)
    }

    public ListGraphs(t: TargetRef): Promise<unknown>
    {
        this.Calls.push(['ListGraphs', t])
        return Promise.resolve({ Ok: true, Value: ['main'] })
    }
}

class Targets
{
    public static readonly Dev: TargetRef = { Name: 'dev', Source: TargetSource.Console }
    // A ref that carries more than Name and Source (an EnvironmentTarget is one structurally).
    public static readonly PlatformTarget = { Id: 'platform:dev', Name: 'dev', Status: 'running', Source: TargetSource.Platform } as TargetRef
    public static readonly PlatformRef: TargetRef = { Name: 'dev', Source: TargetSource.Platform }
}

describe('IpcGraphContributor', () =>
{
    afterEach(() =>
    {
        delete (globalThis as any).api
    })

    it('throws when the bridge is unavailable', () =>
    {
        (globalThis as any).api = {}
        expect(() => new IpcGraphContributor()).toThrow(/graphContribute is unavailable/)
    })

    it('throws when window.api is entirely absent', () =>
    {
        delete (globalThis as any).api
        expect(() => new IpcGraphContributor()).toThrow(/graphContribute is unavailable/)
    })

    it('forwards Contribute with the target and unwraps the result', async () =>
    {
        const fake = new FakeGraphContribute();
        (globalThis as any).api = { graphContribute: fake }
        const pkgs = [{ id: 'p' }] as any
        const result = await new IpcGraphContributor().Contribute(Targets.Dev, 'g', 's', pkgs)
        expect(result).toEqual({ GraphName: 'g', PackageCount: 1 })
        expect(fake.Calls[0]).toEqual(['Contribute', Targets.Dev, 'g', 's', pkgs])
    })

    it('forwards ListGraphs with the target', async () =>
    {
        const fake = new FakeGraphContribute();
        (globalThis as any).api = { graphContribute: fake }
        expect(await new IpcGraphContributor().ListGraphs(Targets.Dev)).toEqual(['main'])
        expect(fake.Calls[0]).toEqual(['ListGraphs', Targets.Dev])
    })

    it('sends only Name and Source across the bridge', async () =>
    {
        const fake = new FakeGraphContribute();
        (globalThis as any).api = { graphContribute: fake }
        await new IpcGraphContributor().Contribute(Targets.PlatformTarget, 'g', 's', [])
        await new IpcGraphContributor().ListGraphs(Targets.PlatformTarget)
        expect(fake.Calls.map((c) => c[1])).toStrictEqual([Targets.PlatformRef, Targets.PlatformRef])
    })

    it('rejects with the failure sentence, rebuilding an account error', async () =>
    {
        const fake = new FakeGraphContribute();
        (globalThis as any).api = { graphContribute: fake }
        fake.Reply = { Ok: false, Error: { Message: 'The environment dev could not be reached.' } }
        await expect(new IpcGraphContributor().Contribute(Targets.Dev, 'g', 's', [])).rejects.toThrow('The environment dev could not be reached.')
        fake.Reply = { Ok: false, Error: { Message: "You're signed out. Sign in and try again.", Kind: AccountErrorKind.SignedOut } }
        const error = await new IpcGraphContributor().Contribute(Targets.Dev, 'g', 's', []).catch((e: unknown) => e)
        expect(error).toBeInstanceOf(AccountError)
        expect((error as AccountError).Kind).toBe(AccountErrorKind.SignedOut)
    })
})
