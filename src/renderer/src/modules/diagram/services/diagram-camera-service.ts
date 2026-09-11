import { ServiceBase, ServiceKey, type Disposable, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import {
    ContentHostService, Diagram, DiagramDocument, ScrollViewer,
    type DocumentsContentHostService, type IDocument,
} from '@pragmatic-tech-ai/mural/framework'
import { FileDiagramStorage } from '../persistence/file-diagram-storage.js'
import { readCamera, writeCamera } from '../persistence/diagram-camera-store.js'

// App-scoped observer: for every open DiagramDocument, restore the persisted
// camera (zoom + scroll offset) onto the document's published ActiveView when it
// mounts, and write it back (debounced) into the document metadata whenever the
// zoom or scroll offset changes. The
// metadata round-trips through the .diagram file, so a diagram reopens where the
// user left it. Applies to EVERY diagram — the generic module owns it.
//
// Mirrors ArchDiagramBindingService (open-docs subscription) and
// attachAutoOpenInspector (rebinding on DiagramDocument.ActiveViewKey).
export class DiagramCameraService extends ServiceBase
{
    public static readonly Key = new ServiceKey<DiagramCameraService>('DiagramCameraService')

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
    // hydrates the camera (guarded so the hydrate write doesn't loop back into a
    // persist) and (re)subscribes camera-change persistence.
    private attach(doc: IDocument): void
    {
        if (this.bindings.has(doc) || !(doc instanceof DiagramDocument)) return

        let detachView: (() => void) | undefined
        let timer: ReturnType<typeof setTimeout> | undefined
        let hydrating = false

        const persist = (): void => {
            const view = doc.ActiveView
            if (view === undefined) return
            writeCamera(doc, view.Camera)
            doc.Save()
            const store = doc.Storage
            if (store instanceof FileDiagramStorage) void store.WhenWritten()
        }

        const onCameraChanged = (): void => {
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
            // Hydrate: apply the persisted camera without triggering a persist.
            const saved = readCamera(doc)
            if (saved !== undefined) {
                hydrating = true
                try { view.SetCamera(saved) } finally { hydrating = false }
            }
            // Zoom lives on the Diagram (LayoutTransform scale); pan is the
            // ScrollViewer's scroll offset. Watch both so a scroll-only change
            // (no zoom) still persists.
            const scroll = view.ScrollHost
            const subZoom = view.PropertyChanged(Diagram.ZoomKey).subscribe(onCameraChanged)
            const subH    = scroll?.PropertyChanged(ScrollViewer.HorizontalOffsetKey).subscribe(onCameraChanged)
            const subV    = scroll?.PropertyChanged(ScrollViewer.VerticalOffsetKey).subscribe(onCameraChanged)
            detachView = (): void => {
                subZoom.dispose()
                subH?.dispose()
                subV?.dispose()
            }
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
