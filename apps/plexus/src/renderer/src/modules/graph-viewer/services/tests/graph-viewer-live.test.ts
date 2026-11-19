import { describe, it, expect } from 'vitest'
import { ServiceProvider, ObservableCollection } from '@pragmatic-tech-ai/mural/runtime'
import { ContentHostService, type IDocument } from '@pragmatic-tech-ai/mural/framework'
import type { TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { GraphData } from '../../graph-data.js'
import { GraphSourceKey, type IGraphSource } from '../graph-cypher-source.js'
import { GraphViewerService, GraphViewMode } from '../graph-viewer-service.js'
import { GraphViewerDocument } from '../../graph-viewer-document.js'
import { GraphNodeVM } from '../../graph-node-vm.js'

const target = { Name: 'dev', Source: 'local' } as unknown as TargetRef

const first: GraphData = {
    Nodes: [{ Id: 'a', Concept: 'actor', Label: 'A', Properties: {} }],
    Edges: [],
}
const second: GraphData = {
    Nodes: [
        { Id: 'x', Concept: 'actor', Label: 'X', Properties: {} },
        { Id: 'y', Concept: 'actor', Label: 'Y', Properties: {} },
    ],
    Edges: [{ From: 'x', Type: 'r', To: 'y' }],
}

// A source that yields `first` on the opening pull and `second` on every later pull,
// counting calls so the test can assert how many times the graph was read.
function sequencedSource(): { source: IGraphSource, calls: () => number }
{
    let n = 0
    const source: IGraphSource = {
        LoadGraph: async () => { n++; return n === 1 ? first : second },
    }
    return { source, calls: () => n }
}

function wire(source: IGraphSource): { provider: ServiceProvider, opened: IDocument[] }
{
    const provider = new ServiceProvider()
    provider.registerInstance(GraphSourceKey, source)
    const opened: IDocument[] = []
    const host = {
        Open: (d: IDocument) => { opened.push(d) },
        OpenDocuments: new ObservableCollection<IDocument>(),
        ActiveDocument: undefined,
    } as unknown as ContentHostService
    provider.registerInstance(ContentHostService.Key, host)
    return { provider, opened }
}

function ids(doc: GraphViewerDocument): string[]
{
    return (doc.Nodes.ToArray() as GraphNodeVM[]).map((v) => v.Id).sort()
}

describe('GraphViewerDocument.Refresh (manual re-pull — Live has no env push plane)', () =>
{
    it('Refresh re-pulls and re-projects the graph', async () =>
    {
        const { source, calls } = sequencedSource()
        const { provider, opened } = wire(source)
        await new GraphViewerService(provider).OpenGraph(target, 'g', GraphViewMode.Live)

        const doc = opened[0] as GraphViewerDocument
        expect(calls()).toBe(1)
        expect(ids(doc)).toEqual(['a'])

        await doc.Refresh()

        expect(calls()).toBe(2)
        expect(ids(doc)).toEqual(['x', 'y'])
        expect(doc.Connectors.Count).toBe(1)
    })

    it('opening does not auto re-pull — no hidden change subscription', async () =>
    {
        const { source, calls } = sequencedSource()
        const { provider } = wire(source)
        await new GraphViewerService(provider).OpenGraph(target, 'g', GraphViewMode.Live)
        // No change signal is wired to the renderer, so nothing re-pulls on its own.
        await Promise.resolve()
        expect(calls()).toBe(1)
    })

    it('Refresh works the same in Snapshot mode', async () =>
    {
        const { source, calls } = sequencedSource()
        const { provider, opened } = wire(source)
        await new GraphViewerService(provider).OpenGraph(target, 'g', GraphViewMode.Snapshot)
        const doc = opened[0] as GraphViewerDocument
        await doc.Refresh()
        expect(calls()).toBe(2)
        expect(ids(doc)).toEqual(['x', 'y'])
    })
})
