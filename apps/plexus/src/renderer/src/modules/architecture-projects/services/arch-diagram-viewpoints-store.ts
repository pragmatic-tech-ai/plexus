import type { DiagramDocument } from '@pragmatic-tech-ai/mural/framework'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { readDiagramViewpoints } from './diagram-viewpoints.js'

// The governing viewpoints of an architecture diagram are serialized WITH the
// diagram, in the document's opaque metadata (DiagramDocument.Metadata) under
// this namespaced key, so they travel with the .diagram file and restore on
// open. Supersedes the project-manifest storage (kept only as a load-time
// fallback for diagrams saved before this change).
export const ARCH_VIEWPOINTS_KEY = 'arch.viewpoints'

// The viewpoints recorded on the document, or undefined when none are set (or
// the stored value isn't a string array). Undefined lets the caller default to
// "all viewpoints".
export function readViewpoints(doc: DiagramDocument): string[] | undefined
{
    const raw = doc.Metadata[ARCH_VIEWPOINTS_KEY]
    if (!Array.isArray(raw) || !raw.every((v) => typeof v === 'string')) return undefined
    return raw as string[]
}

// Merge the viewpoint selection into the document metadata, preserving any
// other keys. The caller persists by saving the document.
export function writeViewpoints(doc: DiagramDocument, ids: string[]): void
{
    doc.Metadata = { ...doc.Metadata, [ARCH_VIEWPOINTS_KEY]: [...ids] }
}

// Write the viewpoint selection straight into the `.diagram` file's metadata,
// preserving the rest of the scene. Used at CREATION, where the participant runs
// after the file is written but before the document opens (no live document to
// set metadata on) — so the viewpoints are already in the file when it opens and
// DiagramDocument._deserialize restores them. A new diagram is seeded with a
// valid empty scene, so the parse+merge preserves nodes/connectors/nextId.
export async function writeViewpointsToFile(storage: IStorage, path: string, ids: string[]): Promise<void>
{
    let base: Record<string, unknown> = {}
    try {
        const text = await storage.ReadText(path)
        if (text.trim() !== '') base = JSON.parse(text) as Record<string, unknown>
    } catch { /* missing/empty file → start from an empty object */ }
    const metadata = { ...((base.metadata as Record<string, unknown> | undefined) ?? {}), [ARCH_VIEWPOINTS_KEY]: [...ids] }
    await storage.WriteText(path, JSON.stringify({ ...base, metadata }))
}

// Load the viewpoints for a diagram: the document metadata first, then the
// legacy project manifest (diagrams saved before the metadata slot existed).
// Undefined = no selection recorded anywhere → the caller defaults to all.
export async function loadViewpoints(
    doc: DiagramDocument,
    storage: IStorage,
    path: string,
): Promise<string[] | undefined>
{
    const fromDoc = readViewpoints(doc)
    if (fromDoc !== undefined) return fromDoc
    return readDiagramViewpoints(storage, path)
}
