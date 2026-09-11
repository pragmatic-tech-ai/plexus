import {
    Diagram,
    DiagramDocument,
    DocumentsContentHostService,
    type IDockPanel,
    type PanelDockService,
} from '@pragmatic-tech-ai/mural/framework'
import { type Disposable } from '@pragmatic-tech-ai/mural/runtime'

// The Id every DiagramInspector shares (DiagramInspector ctor: 'diagram-format').
// The dock dedups panels by Id, so at most one Format Shape panel is ever docked
// — we swap which document's inspector occupies it.
const FORMAT_INSPECTOR_ID = 'diagram-format'

// Auto-open the ACTIVE diagram's Format Shape inspector the first time a shape is
// selected on it. The panel follows the active document: each DiagramDocument owns
// its own inspector (bound to its own ActiveView), so switching diagrams swaps the
// docked inspector to the one that actually edits what's on screen. Without this
// the panel would stay bound to whatever document opened it first — editing a
// different diagram's shape would then apply to nothing.
//
// A behavior (MVVM's third leg): it reads VIEW state (the active Diagram's
// SelectionCount) — which a view-model may not — and translates it into a service
// write (PanelDockService.Add). It holds only view-transient lifecycle state (the
// per-document one-shot latch + listener handles); the inspectors and their
// selection tracking live on the DiagramDocuments.
//
// Wired from the bootstrap (main.js) with the document host. It watches the host's
// ActiveDocument, then that document's published ActiveView, so it needs no hook
// into the template-materialized tree: when a canvas mounts and publishes itself
// onto ActiveView, we attach the selection listener then.
export function attachAutoOpenInspector(
    host: DocumentsContentHostService,
    dock: PanelDockService,
): () => void
{
    // Per-document one-shot latch: once the panel auto-opened for a document,
    // selecting more shapes there won't force it back after the user closes it.
    // Keyed by document, so each diagram gets its own "respect close".
    const openedFor = new WeakSet<DiagramDocument>()

    let watchedDoc: DiagramDocument | undefined
    let detachView: Disposable | undefined       // watchedDoc.ActiveViewKey listener
    let detachSelection: Disposable | undefined  // ActiveView.SelectionCountKey listener

    // The Format Shape panel currently docked (any document's inspector), if any.
    const dockedInspector = (): IDockPanel | undefined =>
    {
        for (const p of dock.Panels) if (p?.Id === FORMAT_INSPECTOR_ID) return p
        return undefined
    }

    // Make this document's inspector the docked one. The dock dedups by Id, so a
    // stale sibling would win a plain Add() — remove it first. No-op if correct.
    const showInspectorFor = (doc: DiagramDocument): void =>
    {
        const current = dockedInspector()
        if (current === doc.Inspector) return
        if (current !== undefined) dock.Remove(current)
        dock.Add(doc.Inspector)
    }

    const onSelectionCountChanged = (): void =>
    {
        const doc = watchedDoc
        if (doc === undefined || openedFor.has(doc)) return
        const view = doc.ActiveView
        if (view === undefined || view.SelectionCount === 0) return
        showInspectorFor(doc)
        openedFor.add(doc)
    }

    // (Re)bind the selection listener to the watched document's current ActiveView.
    const onViewChanged = (): void =>
    {
        detachSelection?.dispose()
        detachSelection = undefined
        const view = watchedDoc?.ActiveView
        if (view === undefined) return
        detachSelection = view.PropertyChanged(Diagram.SelectionCountKey).subscribe(onSelectionCountChanged)
        // A shape may already be selected by the time the view mounts / re-activates.
        onSelectionCountChanged()
    }

    // Re-point everything at the newly active document.
    const onActiveDocChanged = (): void =>
    {
        detachView?.dispose();      detachView = undefined
        detachSelection?.dispose(); detachSelection = undefined
        const doc = host.ActiveDocument
        watchedDoc = doc instanceof DiagramDocument ? doc : undefined
        const active = watchedDoc
        if (active === undefined) return
        // If the panel is already open, follow the active document (swap the stale
        // inspector out) so edits target the diagram on screen. If it's closed,
        // leave it closed — respect the user's close until a fresh selection.
        if (dockedInspector() !== undefined)
        {
            showInspectorFor(active)
            openedFor.add(active)
        }
        detachView = active.PropertyChanged(DiagramDocument.ActiveViewKey).subscribe(onViewChanged)
        onViewChanged()
    }

    const hostSub: Disposable = host.PropertyChanged(DocumentsContentHostService.ActiveDocumentKey).subscribe(onActiveDocChanged)
    onActiveDocChanged()

    return (): void =>
    {
        hostSub.dispose()
        detachView?.dispose()
        detachSelection?.dispose()
    }
}
