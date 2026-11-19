import { RelayCommand, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import { BoardDocument } from '@pragmatic-tech-ai/mural/framework'

// Re-pulls the live graph and rebuilds a GraphViewerDocument's content. Implemented by
// GraphProjection and set on the document by GraphViewerService, so the document can
// refresh itself without importing the projection pipeline (keeps the dependency one-way).
export interface IGraphRefresher
{
    Refresh(doc: GraphViewerDocument): Promise<void>
}

// GraphViewerDocument — the read-only board document behind the graph viewer.
//
// A thin BoardDocument subclass whose first job is to be a distinct type: the viewer's
// `DataTemplate [DataType = GraphViewerDocument]` resolves against it by exact type, so
// the editable `[DataType = BoardDocument]` canvas template (Mutator / DropReceiver /
// context menu) never applies here. Read-only is a property of that template + context
// composition, not of this class — so it adds no mutation guards.
//
// Constructed with NO BoardStorage, so the inherited Save()/Load() short-circuit (they
// no-op when Storage is undefined): the viewer never persists and never dirties from a save.
//
// A refresher (set by the service) re-pulls + re-projects the whole graph on demand —
// the Refresh action, surfaced in the viewer header. There is no env-relay change push
// to the renderer, so Live mode is manual Refresh, not auto-subscribe.
export class GraphViewerDocument extends BoardDocument
{
    private static readonly DefaultTitle = 'Graph'

    private refresher: IGraphRefresher | undefined
    private readonly _refreshCommand: RelayCommand

    constructor()
    {
        // No storage — an in-memory, non-persisting document.
        super()
        this.Title = GraphViewerDocument.DefaultTitle
        this._refreshCommand = new RelayCommand(() => { void this.Refresh() })
    }

    // The viewer header binds this to the Refresh button.
    public get RefreshCommand(): ICommand { return this._refreshCommand }

    // Wire how this document re-pulls its graph. Set once by the service at open.
    public SetRefresher(refresher: IGraphRefresher): void
    {
        this.refresher = refresher
    }

    // Re-pull the live graph and rebuild this document. A no-op if no refresher was set.
    public async Refresh(): Promise<void>
    {
        await this.refresher?.Refresh(this)
    }

    // Clear the dirty flag. Projecting the graph adds connectors, and
    // BoardDocument.CreateConnector marks the document dirty; with no storage the flag
    // could never otherwise clear, so a read-only viewer would falsely show unsaved
    // changes. Called after each (re)projection. Safe because the viewer never persists.
    public MarkClean(): void
    {
        this.set_property_value(BoardDocument.IsDirtyKey, false)
    }
}
