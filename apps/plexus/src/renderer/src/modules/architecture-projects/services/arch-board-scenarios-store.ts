import type { BoardDocument } from '@pragmatic-tech-ai/mural/framework'

// The scenarios "shown" on an architecture board are serialized WITH the
// board, in the document's opaque metadata (BoardDocument.Metadata) under
// this namespaced key, so they travel with the .board file and restore on
// open. The binding projects each active scenario's steps as connectors between
// the placed participant nodes (see ArchBoardBinding.projectEdges), which is
// how a dropped scenario's flow survives the connector-authoritative rescan and
// a reload.
export const ARCH_SCENARIOS_KEY = 'arch.scenarios'

// The scenario ids recorded on the document; [] when none (or the stored value
// isn't a string array).
export function readScenarios(doc: BoardDocument): string[]
{
    const raw = doc.Metadata[ARCH_SCENARIOS_KEY]
    if (!Array.isArray(raw) || !raw.every((v) => typeof v === 'string')) return []
    return raw as string[]
}

// Merge the scenario id list into the document metadata, preserving other keys.
// The caller persists by saving the document.
export function writeScenarios(doc: BoardDocument, ids: string[]): void
{
    doc.Metadata = { ...doc.Metadata, [ARCH_SCENARIOS_KEY]: [...ids] }
}
