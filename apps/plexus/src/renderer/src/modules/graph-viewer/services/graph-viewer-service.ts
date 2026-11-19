import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ContentHostService, DialogService, type DocumentsContentHostService } from '@pragmatic-tech-ai/mural/framework'
import type { TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { GraphData } from '../graph-data.js'
import { EnvironmentsApiKey } from '../../../services/environments/environments-contents-source.js'
import { GraphCypherSource, GraphSourceKey, type IGraphSource } from './graph-cypher-source.js'
import { GraphBoardProjector } from './graph-board-projector.js'
import { GraphLayout } from './graph-layout.js'
import { GraphViewerDocument } from '../graph-viewer-document.js'

// How the viewer tracks the underlying graph. Snapshot projects once (a Refresh
// re-pulls on demand); Live subscribes and re-projects on change. The Live wiring
// lands in a later task — OpenGraph projects once for both today.
export enum GraphViewMode
{
    Snapshot,
    Live,
}

// GraphViewerService — orchestrates opening a read-only Board view of a deployed
// graph: read the whole graph for a target, guard against an over-large render,
// project it onto a GraphViewerDocument, seed fresco positions, and hand the
// document to the content host. Read-only is a property of the viewer document's
// template, not of this service. Collaborators are resolved from the provider
// (no globals); the graph source is a replaceable seam (GraphSourceKey), defaulting
// to the live-Cypher reader built over the registered environments API.
export class GraphViewerService extends ServiceBase
{
    public static readonly Key = new ServiceKey<GraphViewerService>('GraphViewerService')

    // Above this node count, rendering the whole raw graph may be slow, so the user
    // is asked to confirm before layout + open (design: scale guard, start at 800).
    private static readonly ScaleThreshold = 800
    private static readonly ScaleTitle = 'Large graph'
    private static readonly ScaleMessagePrefix = 'This graph has '
    private static readonly ScaleMessageSuffix = ' nodes; rendering may be slow. Continue?'
    private static readonly ConfirmLabel = 'Open anyway'
    private static readonly ApiUnavailable =
        'GraphViewerService: no graph source and no environments API are registered; cannot read the graph.'

    constructor(provider: IServiceProvider)
    {
        super(provider)
    }

    public async OpenGraph(target: TargetRef, graphName: string, mode: GraphViewMode): Promise<void>
    {
        const data = await this.Source().LoadGraph(target)
        if (!(await this.WithinScale(data)))
        {
            return
        }

        const doc = new GraphViewerDocument()
        doc.Title = graphName
        new GraphBoardProjector().Project(data, doc)
        new GraphLayout().Apply(doc)
        this.Host().Open(doc)

        // Live subscription/refresh wiring is a later task; Snapshot and Live both
        // project once here today.
        void mode
    }

    // Ask before rendering an over-large graph. Returns true to proceed. When no
    // DialogService is present (headless) the guard cannot prompt, so it proceeds.
    private async WithinScale(data: GraphData): Promise<boolean>
    {
        if (data.Nodes.length <= GraphViewerService.ScaleThreshold)
        {
            return true
        }
        const dialogs = this.Provider.get(DialogService.Key)
        if (dialogs === undefined)
        {
            return true
        }
        return dialogs.Confirm({
            Title: GraphViewerService.ScaleTitle,
            Message: GraphViewerService.ScaleMessage(data.Nodes.length),
            ConfirmLabel: GraphViewerService.ConfirmLabel,
        })
    }

    private static ScaleMessage(count: number): string
    {
        return `${GraphViewerService.ScaleMessagePrefix}${count}${GraphViewerService.ScaleMessageSuffix}`
    }

    // The graph source: a registered override (GraphSourceKey) if present, else the
    // live-Cypher reader over the environments API.
    private Source(): IGraphSource
    {
        const registered = this.Provider.get(GraphSourceKey)
        if (registered !== undefined)
        {
            return registered
        }
        const api = this.Provider.get(EnvironmentsApiKey)
        if (api === undefined)
        {
            throw new Error(GraphViewerService.ApiUnavailable)
        }
        return new GraphCypherSource(api)
    }

    private Host(): DocumentsContentHostService
    {
        return this.Provider.get(ContentHostService.Key) as unknown as DocumentsContentHostService
    }
}

export default GraphViewerService
