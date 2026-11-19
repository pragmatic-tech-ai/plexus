import { PROJECT_MANIFEST_FILENAME } from '@pragmatic-tech-ai/plexus-core/renderer/projects/project-factory.js'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

// The per-board viewpoint selection lives in the architecture manifest under
// `boards[<project-relative board path>].viewpoints`. Read-modify-write so
// the meta-model / libraries / name bindings are preserved.
interface ManifestWithBoards
{
    boards?: { [path: string]: { viewpoints: string[] } }
    [k: string]: unknown
}

export async function readBoardViewpoints(storage: IStorage, path: string): Promise<string[] | undefined>
{
    // Optional per-board config: a missing or unreadable manifest just means
    // "no selection" (the caller defaults to all viewpoints).
    let text: string
    try
    {
        text = await storage.ReadText(PROJECT_MANIFEST_FILENAME)
    }
    catch
    {
        return undefined
    }
    const manifest = JSON.parse(text) as ManifestWithBoards
    return manifest.boards?.[path]?.viewpoints
}

export async function writeBoardViewpoints(storage: IStorage, path: string, viewpoints: string[]): Promise<void>
{
    const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as ManifestWithBoards
    const boards = manifest.boards ?? {}
    boards[path] = { viewpoints }
    manifest.boards = boards
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2))
}
