import { ServiceBase, ServiceKey, type Disposable, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import {
    ContentHostService, Diagram, DiagramDocument,
    type DocumentsContentHostService, type IDocument,
} from '@pragmatic-tech-ai/mural/framework'
import { FileDiagramStorage } from '../persistence/file-diagram-storage.js'
import { readGuides, writeGuides } from '../persistence/diagram-guides-store.js'

// App-scoped observer: for every open DiagramDocument, restore its persisted ruler
// guides onto the published ActiveView when it mounts, and write them back
// (debounced) into the document metadata whenever they change. The metadata
// round-trips through the .diagram file, so guides reopen where the user left
// them. Applies to EVERY diagram. Mirrors DiagramCameraService.
export class DiagramGuidesService extends ServiceBase
{
    public static readonly Key = new ServiceKey<DiagramGuidesService>('DiagramGuidesService')

    private readonly bindings = new Map<IDocument, () => void>()   // doc → detach

    public constructor(provider: IServiceProvider, private readonly persistDelayMs = 500)
    {
        super(provider)
        const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        host?.OpenDocuments.Subscribe(() => this.sync(host))
    }

    private sync(host: DocumentsContentHostService): void
    {
        const current = new Set(host.OpenDocuments.ToArray())
        for (const [doc, detach] of [...this.bindings]) {
            if (!current.has(doc)) { detach(); this.bindings.delete(doc) }
        }
        for (const doc of current) this.attach(doc)
    }

    // Idempotent per document. Subscribes to ActiveView (re)publication; on each,
    // hydrates the guides (guarded so the hydrate write doesn't loop back into a
    // persist) and (re)subscribes guide-change persistence.
    private attach(doc: IDocument): void
    {
        if (this.bindings.has(doc) || !(doc instanceof DiagramDocument)) return

        let detachView: (() => void) | undefined
        let timer: ReturnType<typeof setTimeout> | undefined
        let hydrating = false

        const persist = (): void => {
            const view = doc.ActiveView
            if (view === undefined) return
            writeGuides(doc, { guides: view.Guides })
            doc.Save()
            const store = doc.Storage
            if (store instanceof FileDiagramStorage) void store.WhenWritten()
        }

        const onChanged = (): void => {
            if (hydrating) return
            if (timer !== undefined) clearTimeout(timer)
            timer = setTimeout(persist, this.persistDelayMs)
        }

        let subActiveView: Disposable | undefined

        const rebindView = (): void => {
            detachView?.()
            detachView = undefined
            const view = doc.ActiveView
            if (view === undefined) return
            // Hydrate: apply the persisted guides without triggering a persist.
            const saved = readGuides(doc)
            if (saved !== undefined) {
                hydrating = true
                try { view.Guides = saved.guides } finally { hydrating = false }
            }
            const subGuides = view.PropertyChanged(Diagram.GuidesKey).subscribe(onChanged)
            detachView = (): void => { subGuides.dispose() }
        }

        subActiveView = doc.PropertyChanged(DiagramDocument.ActiveViewKey).subscribe(rebindView)
        rebindView()

        this.bindings.set(doc, () => {
            if (timer !== undefined) clearTimeout(timer)
            detachView?.()
            subActiveView?.dispose()
            subActiveView = undefined
        })
    }
}
