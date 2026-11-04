import { afterEach, describe, expect, it } from 'vitest'
import { AccountError, AccountErrorKind } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import IpcGraphContributor from '../ipc-graph-contributor.js'

class FakeGraphContribute
{
    public readonly Calls: unknown[][] = []
    public Reply: unknown = { Ok: true, Value: { GraphName: 'g', PackageCount: 1 } }

    public Contribute(e: string, g: string, s: string, p: unknown[]): Promise<unknown>
    {
        this.Calls.push(['Contribute', e, g, s, p])
        return Promise.resolve(this.Reply)
    }

    public ListGraphs(e: string): Promise<unknown>
    {
        this.Calls.push(['ListGraphs', e])
        return Promise.resolve({ Ok: true, Value: ['main'] })
    }
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

    it('forwards Contribute with the environment and unwraps the result', async () =>
    {
        const fake = new FakeGraphContribute();
        (globalThis as any).api = { graphContribute: fake }
        const pkgs = [{ id: 'p' }] as any
        const result = await new IpcGraphContributor().Contribute('dev', 'g', 's', pkgs)
        expect(result).toEqual({ GraphName: 'g', PackageCount: 1 })
        expect(fake.Calls[0]).toEqual(['Contribute', 'dev', 'g', 's', pkgs])
    })

    it('forwards ListGraphs with the environment', async () =>
    {
        const fake = new FakeGraphContribute();
        (globalThis as any).api = { graphContribute: fake }
        expect(await new IpcGraphContributor().ListGraphs('dev')).toEqual(['main'])
        expect(fake.Calls[0]).toEqual(['ListGraphs', 'dev'])
    })

    it('rejects with the failure sentence, rebuilding an account error', async () =>
    {
        const fake = new FakeGraphContribute();
        (globalThis as any).api = { graphContribute: fake }
        fake.Reply = { Ok: false, Error: { Message: 'The environment dev could not be reached.' } }
        await expect(new IpcGraphContributor().Contribute('dev', 'g', 's', [])).rejects.toThrow('The environment dev could not be reached.')
        fake.Reply = { Ok: false, Error: { Message: "You're signed out. Sign in and try again.", Kind: AccountErrorKind.SignedOut } }
        const error = await new IpcGraphContributor().Contribute('dev', 'g', 's', []).catch((e: unknown) => e)
        expect(error).toBeInstanceOf(AccountError)
        expect((error as AccountError).Kind).toBe(AccountErrorKind.SignedOut)
    })
})
