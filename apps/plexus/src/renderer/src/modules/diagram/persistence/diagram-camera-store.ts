import type { DiagramDocument } from '@pragmatic-tech-ai/mural/framework'

// The diagram camera (zoom + scroll offset) is serialized WITH the diagram, in
// the document's opaque metadata (DiagramDocument.Metadata) under this namespaced
// key, so it travels with the .diagram file and restores on open. Mirrors the
// viewpoints store (arch-diagram-viewpoints-store.ts). Applies to every
// .diagram, not just architecture ones — hence the generic key.
//
// Zoom is the diagram's LayoutTransform scale; the offset is the ScrollViewer's
// scroll offset (mural 0.9.0 replaced the old render-camera pan with scrollbars).
export const DIAGRAM_CAMERA_KEY = 'camera'

export interface DiagramCameraState { readonly zoom: number; readonly offsetX: number; readonly offsetY: number }

function isState(v: unknown): v is DiagramCameraState {
    if (typeof v !== 'object' || v === null) return false
    const r = v as Record<string, unknown>
    return typeof r.zoom === 'number' && typeof r.offsetX === 'number' && typeof r.offsetY === 'number'
}

// The camera recorded on the document, or undefined when none is set (or the
// stored value is malformed). Undefined lets the caller keep the identity default.
export function readCamera(doc: DiagramDocument): DiagramCameraState | undefined {
    const raw = doc.Metadata[DIAGRAM_CAMERA_KEY]
    if (!isState(raw)) return undefined
    return { zoom: raw.zoom, offsetX: raw.offsetX, offsetY: raw.offsetY }
}

// Merge the camera into the document metadata, preserving any other keys. The
// caller persists by saving the document.
export function writeCamera(doc: DiagramDocument, state: DiagramCameraState): void {
    doc.Metadata = { ...doc.Metadata, [DIAGRAM_CAMERA_KEY]: { zoom: state.zoom, offsetX: state.offsetX, offsetY: state.offsetY } }
}
