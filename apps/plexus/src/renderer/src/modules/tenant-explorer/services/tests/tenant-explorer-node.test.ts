import { describe, expect, it, vi } from 'vitest'
import { TenantExplorerNode, TenantExplorerNodeKind } from '../tenant-explorer-node'

describe('TenantExplorerNode', () =>
{
    it('factories set the expected kind and leaves start empty', () =>
    {
        expect(TenantExplorerNode.Tenant('t').Kind).toBe(TenantExplorerNodeKind.Tenant)
        expect(TenantExplorerNode.Application('a').Kind).toBe(TenantExplorerNodeKind.Application)
        expect(TenantExplorerNode.Graph('g').Kind).toBe(TenantExplorerNodeKind.Graph)
        expect(TenantExplorerNode.Message('m').Kind).toBe(TenantExplorerNodeKind.Message)
        for (const n of [TenantExplorerNode.Application('a'), TenantExplorerNode.Graph('g'), TenantExplorerNode.Message('m')])
        {
            expect(n.Children.Count).toBe(0)
        }
        expect(TenantExplorerNode.Graph('g').Label).toBe('g')
    })

    it('environment starts with a Loading sentinel and carries status', () =>
    {
        const env = TenantExplorerNode.Environment('e', 'Running', async () => [])
        expect(env.Kind).toBe(TenantExplorerNodeKind.Environment)
        expect(env.Status).toBe('Running')
        expect(env.Children.Count).toBe(1)
        expect(env.Children.Get(0)!.Kind).toBe(TenantExplorerNodeKind.Message)
        expect(env.Children.Get(0)!.Label).toBe('Loading…')
        expect(TenantExplorerNode.Tenant('t').Status).toBe('')
    })

    it('OnExpand runs the loader once and swaps the sentinel', async () =>
    {
        let calls = 0
        const env = TenantExplorerNode.Environment('e', 'Running', async () =>
        {
            calls++
            return [TenantExplorerNode.Application('a1'), TenantExplorerNode.Graph('g1')]
        })
        env.OnExpand()
        env.OnExpand()
        await vi.waitFor(() => expect(env.Children.Count).toBe(2))
        env.OnExpand()
        expect(calls).toBe(1)
        expect(env.Children.Count).toBe(2)
        expect(env.Children.Get(0)!.Label).toBe('a1')
        expect(env.Children.Get(1)!.Label).toBe('g1')
    })

    it('a rejecting loader leaves a single Failed to load message', async () =>
    {
        const env = TenantExplorerNode.Environment('e', 'Stopped', async () => { throw new Error('x') })
        env.OnExpand()
        await vi.waitFor(() => expect(env.Children.Get(0)!.Label).toBe('Failed to load'))
        expect(env.Children.Count).toBe(1)
        expect(env.Children.Get(0)!.Kind).toBe(TenantExplorerNodeKind.Message)
        expect(env.Children.Get(0)!.Label).toBe('Failed to load')
    })

    it('an empty loader result leaves Children empty', async () =>
    {
        const env = TenantExplorerNode.Environment('e', 'Running', async () => [])
        env.OnExpand()
        await vi.waitFor(() => expect(env.Children.Count).toBe(0))
    })

    it('application and graph nodes have empty Status', () =>
    {
        expect(TenantExplorerNode.Application('a').Status).toBe('')
        expect(TenantExplorerNode.Graph('g').Status).toBe('')
    })

    it('OnExpand on a non-lazy node is a no-op', () =>
    {
        const t = TenantExplorerNode.Tenant('t')
        t.OnExpand()
        expect(t.Children.Count).toBe(0)
    })
})
