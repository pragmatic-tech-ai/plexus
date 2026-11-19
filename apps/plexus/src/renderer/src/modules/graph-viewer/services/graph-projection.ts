import type { TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { GraphData } from '../graph-data.js'
import type { IGraphSource } from './graph-cypher-source.js'
import { GraphBoardProjector } from './graph-board-projector.js'
import { GraphLayout } from './graph-layout.js'
import type { GraphViewerDocument, IGraphRefresher } from '../graph-viewer-document.js'

// GraphProjection — binds a graph source to a target and knows how to (re)build a
// GraphViewerDocument from it: load the whole graph, project it, seed fresco positions.
// It is the document's refresher, so a manual Refresh re-pulls through the same path.
// Holds no document reference itself — the document it fills is passed in each time.
export class GraphProjection implements IGraphRefresher
{
    constructor(private readonly source: IGraphSource, private readonly target: TargetRef)
    {
    }

    // Pull the whole graph once (used by the opener for the scale guard before any
    // document exists).
    public Load(): Promise<GraphData>
    {
        return this.source.LoadGraph(this.target)
    }

    // Replace a document's content with a projection of already-pulled data: clear the
    // old nodes/connectors, project the new graph, seed positions. SetNodeVisual
    // overwrites by id, so re-projecting a changed graph lands cleanly.
    public Apply(data: GraphData, doc: GraphViewerDocument): void
    {
        doc.Nodes.Clear()
        doc.Connectors.Clear()
        new GraphBoardProjector().Project(data, doc)
        new GraphLayout().Apply(doc)
    }

    // Re-pull and re-project — the Refresh path (both view modes; there is no env
    // change push to the renderer, so Live is manual Refresh).
    public async Refresh(doc: GraphViewerDocument): Promise<void>
    {
        this.Apply(await this.Load(), doc)
    }
}
