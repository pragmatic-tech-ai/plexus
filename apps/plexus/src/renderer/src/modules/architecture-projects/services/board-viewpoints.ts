import { PROJECT_MANIFEST_FILENAME } from '@pragmatic-tech-ai/plexus-core/renderer/projects/project-factory.js'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

// Load-time fallback for the per-board viewpoint selection of projects saved BEFORE
// the Diagram→Board rename, which persisted it in the architecture manifest. The
// on-disk key is the legacy `diagrams[<project-relative path>].viewpoints` and MUST
// stay `diagrams` — renaming it to `boards` would make this fallback read a key no
// legacy manifest contains, silently dropping the saved selection. New selections are
// written to the `.board` document metadata (arch.viewpoints), not here. Read-modify-
// write so the meta-model / libraries / name bindings are preserved.
interface LegacyViewpointsManifest
{
    diagrams?: { [path: string]: { viewpoints: string[] } }
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
    const manifest = JSON.parse(text) as LegacyViewpointsManifest
    return manifest.diagrams?.[path]?.viewpoints
}

export async function writeBoardViewpoints(storage: IStorage, path: string, viewpoints: string[]): Promise<void>
{
    const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as LegacyViewpointsManifest
    const diagrams = manifest.diagrams ?? {}
    diagrams[path] = { viewpoints }
    manifest.diagrams = diagrams
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2))
}
