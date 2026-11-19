import { describe, it, expect } from 'vitest'
import { ServiceProvider, ObservableCollection } from '@pragmatic-tech-ai/mural/runtime'
import { ContentHostService, DialogService, type IDocument } from '@pragmatic-tech-ai/mural/framework'
import type { TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { GraphData, GraphNodeData } from '../../graph-data.js'
import { GraphSourceKey, type IGraphSource } from '../graph-cypher-source.js'
import { GraphViewerService, GraphViewMode } from '../graph-viewer-service.js'
import { GraphViewerDocument } from '../../graph-viewer-document.js'
import { GraphNodeVM } from '../../graph-node-vm.js'

const target = { Name: 'dev', Source: 'local' } as unknown as TargetRef

// A provider wired with a fake graph source (returns `data`), a content host that
// captures Open, and — when `confirm` is set — a fake DialogService whose Confirm
// resolves to it.
function wire(data: GraphData, confirm?: boolean): { provider: ServiceProvider, opened: IDocument[] }
{
    const provider = new ServiceProvider()
    const source: IGraphSource = { LoadGraph: async () => data }
    provider.registerInstance(GraphSourceKey, source)

    const opened: IDocument[] = []
    const host = {
        Open: (d: IDocument) => { opened.push(d) },
        OpenDocuments: new ObservableCollection<IDocument>(),
        ActiveDocument: undefined,
    } as unknown as ContentHostService
    provider.registerInstance(ContentHostService.Key, host)

    if (confirm !== undefined)
    {
        provider.registerInstance(DialogService.Key, { Confirm: async () => confirm } as unknown as DialogService)
    }
    return { provider, opened }
}

function bigGraph(n: number): GraphData
{
    const nodes: GraphNodeData[] = []
    for (let i = 0; i < n; i++)
    {
        nodes.push({ Id: `n${i}`, Concept: null, Label: `N${i}`, Properties: {} })
    }
    return { Nodes: nodes, Edges: [] }
}

describe('GraphViewerService.OpenGraph', () =>
{
    it('Snapshot: opens one GraphViewerDocument titled by graphName with the projected nodes', async () =>
    {
        const data: GraphData = {
            Nodes: [
                { Id: 'a', Concept: 'actor', Label: 'Alice', Properties: {} },
                { Id: 'b', Concept: 'actor', Label: 'Bob', Properties: {} },
            ],
            Edges: [{ From: 'a', Type: 'knows', To: 'b' }],
        }
        const { provider, opened } = wire(data)

        await new GraphViewerService(provider).OpenGraph(target, 'g', GraphViewMode.Snapshot)

        expect(opened.length).toBe(1)
        const doc = opened[0]
        expect(doc).toBeInstanceOf(GraphViewerDocument)
        expect(doc!.Title).toBe('g')
        const vms = (doc as GraphViewerDocument).Nodes.ToArray() as GraphNodeVM[]
        expect(vms.map((v) => v.Id).sort()).toEqual(['a', 'b'])
    })

    it('scale guard: over threshold and the user declines -> nothing opened', async () =>
    {
        const { provider, opened } = wire(bigGraph(801), false)
        await new GraphViewerService(provider).OpenGraph(target, 'big', GraphViewMode.Snapshot)
        expect(opened.length).toBe(0)
    })

    it('scale guard: over threshold and the user accepts -> opens', async () =>
    {
        const { provider, opened } = wire(bigGraph(801), true)
        await new GraphViewerService(provider).OpenGraph(target, 'big', GraphViewMode.Snapshot)
        expect(opened.length).toBe(1)
    })
})
