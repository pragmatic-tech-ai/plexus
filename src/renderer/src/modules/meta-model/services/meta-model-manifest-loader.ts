// meta-model-manifest-loader.ts — the published meta-model package descriptor and
// its never-throws read. manifest.json is a DISTINCT artifact from the project's
// on-disk envelope (project.plexus / MetaModelManifest); it mirrors library.json:
// identity plus the package-level annotations projected from the model graph, so
// Plexus can understand a package without parsing model.json.
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

export interface MetaModelManifestFile
{
    id:           string
    version:      string
    name:         string
    description?: string
    annotations:  Record<string, Record<string, unknown>>
}

// Local copy of library-loader's LoadProblem, so this module does not depend on
// the library module.
export interface ManifestProblem { uri: string | null; message: string; severity: 'error' | 'warning' }

export interface LoadedMetaModelManifest extends MetaModelManifestFile
{
    problems: ManifestProblem[]
}

// Load a published meta-model's manifest.json. A malformed or unreadable manifest
// yields a safe default (name = id, no annotations) plus one error problem — never
// throws, mirroring library-loader's loadLibrary.
export async function loadMetaModelManifest(
    backend: IStorage, id: string, version: string,
): Promise<LoadedMetaModelManifest>
{
    const base = `${id}/${version}`
    let file: MetaModelManifestFile
    try {
        file = JSON.parse(await backend.ReadText(`${base}/manifest.json`))
    } catch (e) {
        return {
            id, version, name: id, annotations: {},
            problems: [{ severity: 'error', uri: 'manifest.json',
                         message: `Meta-model manifest is invalid: ${(e as Error).message}` }],
        }
    }
    const loaded: LoadedMetaModelManifest = {
        id: file.id, version: file.version, name: file.name,
        annotations: file.annotations ?? {}, problems: [],
    }
    if (file.description !== undefined) loaded.description = file.description
    return loaded
}
