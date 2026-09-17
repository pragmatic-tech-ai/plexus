import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

// App-provided feed for the window / app title. The service resolves the title
// with the precedence Plexus established: the active document's title, else the
// first open project's name, else the app name. Each app implements the two
// sources (Plexus reads its ContentHost + ProjectExplorer; devUI its own) and
// registers an instance under TitleSourceKey at the composition root. Keeping the
// two sources app-side — while the precedence stays here — is what makes
// TitleService app-agnostic without changing Plexus's mechanism.
export interface ITitleSource
{
    // The app's own name — the fallback title and the suffix in the OS title.
    readonly appName: string
    // Active document title, else undefined.
    activeDocumentTitle(): string | undefined
    // First open project's name, else undefined.
    firstProjectName(): string | undefined
    // Fires whenever either source might have changed; returns an unsubscribe thunk.
    subscribe(onChange: () => void): () => void
}

// The provider key the app registers its ITitleSource under. TitleService (owned
// by the shared PragmaticWindowChrome module) resolves it.
export const TitleSourceKey = new ServiceKey<ITitleSource>('WindowTitleSource')

// The window / app title exposed as a bindable `Title`, mirrored to
// document.title (taskbar / window chrome). The shared title bar binds
// `$service(TitleService).Title`. App-agnostic: all title content comes from the
// app-registered ITitleSource, so this service ships in plexus-core unchanged
// across apps.
export class TitleService extends ServiceBase
{
    public static readonly Key = new ServiceKey<TitleService>('TitleService')

    private _title: string

    constructor(provider: IServiceProvider)
    {
        super(provider)
        const source = provider.getRequired(TitleSourceKey)
        this._title = source.appName
        const recompute = (): void => {
            const name = source.activeDocumentTitle() ?? source.firstProjectName() ?? source.appName
            const old = this._title
            this._title = name
            this.RaisePropertyChanged('Title', old, name)
            if (typeof document !== 'undefined')
            {
                document.title = name === source.appName ? source.appName : `${name} — ${source.appName}`
            }
        }
        source.subscribe(recompute)
        recompute()
    }

    public get Title(): string { return this._title }
}
