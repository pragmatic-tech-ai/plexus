import { BoardDocument } from '@pragmatic-tech-ai/mural/framework'

// GraphViewerDocument — the read-only board document behind the graph viewer.
//
// It is a thin BoardDocument subclass whose ONLY job is to be a distinct type:
// the viewer's `DataTemplate [DataType = GraphViewerDocument]` resolves against it
// by exact type, so the editable `[DataType = BoardDocument]` canvas template (with
// its Mutator / DropReceiver / context menu) never applies here. Read-only is a
// property of that template + context composition, not of this class — so this adds
// no mutation guards.
//
// It is constructed with NO BoardStorage, so the inherited Save()/Load() short-circuit
// (they no-op when Storage is undefined): the viewer never persists and never dirties
// from a save. GraphBoardProjector fills Nodes/Connectors and GraphLayout seeds the
// node visuals before the document is opened.
export class GraphViewerDocument extends BoardDocument
{
    private static readonly DefaultTitle = 'Graph'

    constructor()
    {
        // No storage — an in-memory, non-persisting document.
        super()
        this.Title = GraphViewerDocument.DefaultTitle
    }
}
