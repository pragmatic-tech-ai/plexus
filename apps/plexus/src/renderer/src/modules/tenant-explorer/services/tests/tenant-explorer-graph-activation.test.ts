import { describe, it, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { GraphViewerService, GraphViewMode } from '../../../graph-viewer/services/graph-viewer-service.js'
import { TenantExplorerNode } from '../tenant-explorer-node.js'
import { TenantExplorerService } from '../tenant-explorer-service.js'

interface OpenCall { target: TargetRef, name: string, mode: GraphViewMode }

function serviceWithFakeViewer(calls: OpenCall[]): TenantExplorerService
{
    const provider = new ServiceProvider()
    provider.registerInstance(
        GraphViewerService.Key,
        { OpenGraph: async (target: TargetRef, name: string, mode: GraphViewMode) => { calls.push({ target, name, mode }) } } as unknown as GraphViewerService,
    )
    return new TenantExplorerService(provider)
}

describe('Tenant Explorer graph activation', () =>
{
    it('activating a Graph node opens the viewer with the node target + name (Snapshot)', async () =>
    {
        const calls: OpenCall[] = []
        const service = serviceWithFakeViewer(calls)
        const target = { Name: 'dev', Source: 'local' } as unknown as TargetRef

        service.ActivateGraph(TenantExplorerNode.Graph('orders', target))
        await Promise.resolve()

        expect(calls.length).toBe(1)
        expect(calls[0]!.target).toBe(target)
        expect(calls[0]!.name).toBe('orders')
        expect(calls[0]!.mode).toBe(GraphViewMode.Snapshot)
    })

    it('activating a non-Graph node does nothing', () =>
    {
        const calls: OpenCall[] = []
        const service = serviceWithFakeViewer(calls)
        service.ActivateGraph(TenantExplorerNode.Application('app 1.0'))
        expect(calls.length).toBe(0)
    })

    it('a Graph node forwards OnActivate to its set activation handler', () =>
    {
        let fired = 0
        const node = TenantExplorerNode.Graph('g', { Name: 'dev', Source: 'local' } as unknown as TargetRef)
        node.SetActivation(() => { fired++ })
        node.OnActivate()
        expect(fired).toBe(1)
    })
})
