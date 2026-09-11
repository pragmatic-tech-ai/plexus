import { MuralBase, MetaData, ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ContentHostService, DocumentsContentHostService, type IDocument } from '@pragmatic-tech-ai/mural/framework'
import { ProjectExplorerService } from '../modules/project-explorer/services/project-explorer-service.js'

// The window/app title, resolved with the same precedence the HTML band used
// before the header moved into mural: the active document's Title, else the
// first open project's Name, else "Plexus". Exposed as a bindable `Title` DP so
// the mural header (DataTemplate-less @PlexusTitleBar view) can bind
// `$service(TitleService).Title` directly, and mirrored to `document.title`
// (taskbar / window chrome). Replaces title-bar.ts's imperative title sync.
const APP_NAME = 'Plexus'

// Seam over the two state sources the title derives from, so the service is
// testable without a live content host / explorer (mirrors ViewportService's
// IViewportSource). The default reads the real shell services.
export interface ITitleSource
{
    activeDocumentTitle(): string | undefined
    firstProjectName(): string | undefined
    // Fires whenever either source might have changed; returns an unsubscribe thunk.
    subscribe(onChange: () => void): () => void
}

function shellTitleSource(provider: IServiceProvider): ITitleSource
{
    const host     = provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
    const explorer = provider.get(ProjectExplorerService.Key)
    return {
        activeDocumentTitle: () => (host?.ActiveDocument as IDocument | undefined)?.Title || undefined,
        firstProjectName: () => {
            const projects = explorer?.OpenProjects
            return projects && projects.Count > 0 ? (projects.Get(0)?.Name || undefined) : undefined
        },
        subscribe: (onChange) => {
            host?.PropertyChanged(DocumentsContentHostService.ActiveDocumentKey).subscribe(onChange)
            const unsub = explorer?.OpenProjects.Subscribe(onChange)
            // App-lifetime service: the host subscription has no matching dispose in
            // use elsewhere, so we only forward the explorer unsubscribe.
            return () => unsub?.()
        },
    }
}

export class TitleService extends ServiceBase
{
    public static readonly Key = new ServiceKey<TitleService>('TitleService')
    public static readonly TitleKey = MuralBase.RegisterProperty<string>(TitleService, 'Title', APP_NAME, MetaData.None)

    constructor(provider: IServiceProvider, source: ITitleSource = shellTitleSource(provider))
    {
        super(provider)
        const recompute = (): void => {
            const name = source.activeDocumentTitle() ?? source.firstProjectName() ?? APP_NAME
            this.set_property_value(TitleService.TitleKey, name)
            if (typeof document !== 'undefined')
            {
                document.title = name === APP_NAME ? APP_NAME : `${name} — ${APP_NAME}`
            }
        }
        source.subscribe(recompute)
        recompute()
    }

    public get Title(): string { return this.get_property_value(TitleService.TitleKey) }
}
