import { Diagram, DiagramDocument, type IDocument } from '@pragmatic-tech-ai/mural/framework'

// The bit of the document host the shortcuts read.
interface ZoomHost { readonly ActiveDocument: IDocument | undefined }

// The live diagram view of the active document, if the active document is a
// diagram whose canvas has mounted (published its ActiveView). Undefined
// otherwise → the chord is ignored (nothing swallowed).
function activeView(host: ZoomHost): Diagram | undefined {
    const doc = host.ActiveDocument
    return doc instanceof DiagramDocument ? doc.ActiveView : undefined
}

// Wire Ctrl/⌘ +/−/0 → zoom-in / zoom-out / reset on the active diagram's camera,
// at the window CAPTURE phase (parity with save-shortcuts: fires before editor
// key-swallow boundaries). Only these chords are intercepted, and only when there
// is a live diagram view to receive them. Returns a detach thunk.
export function attachZoomShortcuts(
    host: ZoomHost,
    target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
): () => void {
    const onKeyDown = (e: KeyboardEvent): void => {
        const mod = e.ctrlKey || e.metaKey
        if (!mod) return
        const view = activeView(host)
        if (view === undefined) return
        // '+' and '=' share a physical key; accept both for zoom-in.
        if (e.key === '+' || e.key === '=') { e.preventDefault(); e.stopPropagation(); view.ZoomIn(); return }
        if (e.key === '-') { e.preventDefault(); e.stopPropagation(); view.ZoomOut(); return }
        if (e.key === '0') { e.preventDefault(); e.stopPropagation(); view.ResetZoom(); return }
    }
    target.addEventListener('keydown', onKeyDown, { capture: true })
    return () => target.removeEventListener('keydown', onKeyDown, { capture: true } as EventListenerOptions)
}
