import type { DiagramDocument } from '@pragmatic-tech-ai/mural/framework'
import type { PersistentGuide } from '@pragmatic-tech-ai/mural/runtime'

// Persistent ruler guides travel with the .diagram file in the document's opaque
// metadata (DiagramDocument.Metadata) under this namespaced key, exactly like the
// camera (diagram-camera-store.ts). Applies to every .diagram.
export const DIAGRAM_GUIDES_KEY = 'guides'

export interface DiagramGuidesState { readonly guides: readonly PersistentGuide[] }

function isGuide(v: unknown): v is PersistentGuide {
    if (typeof v !== 'object' || v === null) return false
    const r = v as Record<string, unknown>
    return (r.axis === 'x' || r.axis === 'y') && typeof r.position === 'number' && Array.isArray(r.glued)
}

function isState(v: unknown): v is DiagramGuidesState {
    if (typeof v !== 'object' || v === null) return false
    const g = (v as Record<string, unknown>).guides
    return Array.isArray(g) && g.every(isGuide)
}

// The guides recorded on the document, or undefined when none is set (or the
// stored value is malformed). Undefined lets the caller keep the empty default.
export function readGuides(doc: DiagramDocument): DiagramGuidesState | undefined {
    const raw = doc.Metadata[DIAGRAM_GUIDES_KEY]
    if (!isState(raw)) return undefined
    return {
        guides: (raw.guides as PersistentGuide[]).map(g => ({
            axis: g.axis, position: g.position, glued: g.glued.map(x => ({ ...x })),
        })),
    }
}

// Merge the guides into the document metadata, preserving any other keys. The
// caller persists by saving the document.
export function writeGuides(doc: DiagramDocument, state: DiagramGuidesState): void {
    doc.Metadata = { ...doc.Metadata, [DIAGRAM_GUIDES_KEY]: { guides: state.guides } }
}
