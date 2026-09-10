import { PROJECT_MANIFEST_FILENAME } from '../../../services/projects/project-factory.js'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

// The per-diagram viewpoint selection lives in the architecture manifest under
// `diagrams[<project-relative diagram path>].viewpoints`. Read-modify-write so
// the meta-model / libraries / name bindings are preserved.
interface ManifestWithDiagrams
{
    diagrams?: { [path: string]: { viewpoints: string[] } }
    [k: string]: unknown
}

export async function readDiagramViewpoints(storage: IStorage, path: string): Promise<string[] | undefined>
{
    // Optional per-diagram config: a missing or unreadable manifest just means
    // "no selection" (the caller defaults to all viewpoints).
    let text: string
    try {
        text = await storage.ReadText(PROJECT_MANIFEST_FILENAME)
    } catch {
        return undefined
    }
    const manifest = JSON.parse(text) as ManifestWithDiagrams
    return manifest.diagrams?.[path]?.viewpoints
}

export async function writeDiagramViewpoints(storage: IStorage, path: string, viewpoints: string[]): Promise<void>
{
    const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as ManifestWithDiagrams
    const diagrams = manifest.diagrams ?? {}
    diagrams[path] = { viewpoints }
    manifest.diagrams = diagrams
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2))
}
