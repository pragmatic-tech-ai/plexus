import { afterEach, describe, expect, it } from 'vitest'
import IpcGraphContributor from '../ipc-graph-contributor.js'

class FakeGraphContribute
{
    public readonly Calls: unknown[][] = []

    public Contribute(g: string, s: string, p: unknown[]): Promise<unknown>
    {
        this.Calls.push(['Contribute', g, s, p])
        return Promise.resolve({ Status: 'ok' })
    }

    public SetProfile(u: string, t: string): Promise<void>
    {
        this.Calls.push(['SetProfile', u, t])
        return Promise.resolve()
    }

    public HasProfile(): Promise<boolean>
    {
        this.Calls.push(['HasProfile'])
        return Promise.resolve(true)
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

    it('forwards Contribute and returns the result', async () =>
    {
        const fake = new FakeGraphContribute();
        (globalThis as any).api = { graphContribute: fake }
        const pkgs = [{ Name: 'p' }] as any
        const result = await new IpcGraphContributor().Contribute('g', 's', pkgs)
        expect(result).toEqual({ Status: 'ok' })
        expect(fake.Calls[0]).toEqual(['Contribute', 'g', 's', pkgs])
    })

    it('forwards SetProfile', async () =>
    {
        const fake = new FakeGraphContribute();
        (globalThis as any).api = { graphContribute: fake }
        await new IpcGraphContributor().SetProfile('http://x', 'tok')
        expect(fake.Calls[0]).toEqual(['SetProfile', 'http://x', 'tok'])
    })

    it('HasProfile returns only a boolean', async () =>
    {
        const fake = new FakeGraphContribute();
        (globalThis as any).api = { graphContribute: fake }
        const value = await new IpcGraphContributor().HasProfile()
        expect(typeof value).toBe('boolean')
        expect(value).toBe(true)
    })
})
