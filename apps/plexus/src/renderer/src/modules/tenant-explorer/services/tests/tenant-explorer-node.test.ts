import { describe, expect, it } from 'vitest'
import { TenantExplorerNode, TenantExplorerNodeKind } from '../tenant-explorer-node'

class Flush
{
    public static async Run(): Promise<void>
    {
        for (let i = 0; i < 5; i++) await Promise.resolve()
    }
}

describe('TenantExplorerNode', () =>
{
    it('factories set the expected kind and leaves start empty', () =>
    {
        expect(TenantExplorerNode.tenant('t').Kind).toBe(TenantExplorerNodeKind.Tenant)
        expect(TenantExplorerNode.application('a').Kind).toBe(TenantExplorerNodeKind.Application)
        expect(TenantExplorerNode.graph('g').Kind).toBe(TenantExplorerNodeKind.Graph)
        expect(TenantExplorerNode.message('m').Kind).toBe(TenantExplorerNodeKind.Message)
        for (const n of [TenantExplorerNode.application('a'), TenantExplorerNode.graph('g'), TenantExplorerNode.message('m')])
        {
            expect(n.Children.Count).toBe(0)
        }
        expect(TenantExplorerNode.graph('g').Label).toBe('g')
    })

    it('environment starts with a Loading sentinel and carries status', () =>
    {
        const env = TenantExplorerNode.environment('e', 'Running', async () => [])
        expect(env.Kind).toBe(TenantExplorerNodeKind.Environment)
        expect(env.Status).toBe('Running')
        expect(env.Children.Count).toBe(1)
        expect(env.Children.Get(0)!.Kind).toBe(TenantExplorerNodeKind.Message)
        expect(env.Children.Get(0)!.Label).toBe('Loading…')
        expect(TenantExplorerNode.tenant('t').Status).toBe('')
    })

    it('OnExpand runs the loader once and swaps the sentinel', async () =>
    {
        let calls = 0
        const env = TenantExplorerNode.environment('e', 'Running', async () =>
        {
            calls++
            return [TenantExplorerNode.application('a1'), TenantExplorerNode.graph('g1')]
        })
        env.OnExpand()
        env.OnExpand()
        await Flush.Run()
        env.OnExpand()
        expect(calls).toBe(1)
        expect(env.Children.Count).toBe(2)
        expect(env.Children.Get(0)!.Label).toBe('a1')
        expect(env.Children.Get(1)!.Label).toBe('g1')
    })

    it('a rejecting loader leaves a single Failed to load message', async () =>
    {
        const env = TenantExplorerNode.environment('e', 'Stopped', async () => { throw new Error('x') })
        env.OnExpand()
        await Flush.Run()
        expect(env.Children.Count).toBe(1)
        expect(env.Children.Get(0)!.Kind).toBe(TenantExplorerNodeKind.Message)
        expect(env.Children.Get(0)!.Label).toBe('Failed to load')
    })

    it('OnExpand on a non-lazy node is a no-op', () =>
    {
        const t = TenantExplorerNode.tenant('t')
        t.OnExpand()
        expect(t.Children.Count).toBe(0)
    })
})
