import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import type { BaseRef } from '@pragmatic-tech-ai/plexus-core/renderer/projects/base-binding.js'

export interface LoadProblem { uri: string | null; message: string; severity: 'error' | 'warning' }

export interface LoadedClass
{
    id:            string
    localId?:      string
    label?:        string
    icon?:         string
    concept:       string
    templatePath?: string
    thumbnailPath?: string
    docPath?:      string
}

export interface LoadedLibrary
{
    id:         string
    version:    string
    name:       string
    metaModels: BaseRef[]
    classes:    LoadedClass[]
    problems:   LoadProblem[]
}

// The single package descriptor every published package (meta-model OR library)
// writes at `<id>/<version>/`; its `type` field is the discriminator. A version is
// a LIBRARY iff `bundle.json` exists AND its `type` is 'library'.
const PACKAGE_BUNDLE = 'bundle.json'
const LIBRARY_TYPE = 'library'

// Every published LIBRARY under the backend, loaded. Directory layout is
// `<id>/<version>/…`: root dirs are ids, each id's dirs are versions — but the root
// now holds meta-models too, so only versions whose `bundle.json` has
// `type === 'library'` are loaded.
export async function discoverLibraries(backend: IStorage): Promise<LoadedLibrary[]>
{
    const out: LoadedLibrary[] = []
    const ids = (await backend.List('')).filter((e) => e.IsDirectory).map((e) => e.Name).sort()
    for (const id of ids)
    {
        const versions = (await backend.List(id)).filter((e) => e.IsDirectory).map((e) => e.Name).sort()
        for (const version of versions)
        {
            if (await isLibraryVersion(backend, id, version)) out.push(await loadLibrary(backend, id, version))
        }
    }
    return out
}

// A version is a library iff its bundle.json exists and declares type 'library'.
// A malformed/unreadable bundle.json is treated as not-a-library (it never counts
// as a meta-model either — the meta-model side applies the mirror check).
async function isLibraryVersion(backend: IStorage, id: string, version: string): Promise<boolean>
{
    try
    {
        const bundle = JSON.parse(await backend.ReadText(`${id}/${version}/${PACKAGE_BUNDLE}`)) as { type?: string }
        return bundle.type === LIBRARY_TYPE
    }
    catch { return false }
}

// Load one library's bundle.json into a LoadedLibrary. A malformed/unreadable
// bundle yields empty classes + one error problem (never throws). A class that
// cites a template/thumbnail/doc file with no file on disk records a warning.
export async function loadLibrary(backend: IStorage, id: string, version: string): Promise<LoadedLibrary>
{
    const base = `${id}/${version}`
    const problems: LoadProblem[] = []
    let manifest: {
        id: string; version: string; name: string
        metaModels?: BaseRef[]
        classes: Array<{ id: string; localId?: string; label?: string; concept: string; template?: string; thumbnail?: string; doc?: string; icon?: string }>
    }
    try
    {
        manifest = JSON.parse(await backend.ReadText(`${base}/${PACKAGE_BUNDLE}`))
    }
    catch (e)
    {
        return { id, version, name: id, metaModels: [], classes: [],
                 problems: [{ severity: 'error', uri: PACKAGE_BUNDLE, message: `Library bundle is invalid: ${(e as Error).message}` }] }
    }

    const classes: LoadedClass[] = []
    for (const c of manifest.classes ?? [])
    {
        const cls: LoadedClass = { id: c.id, concept: c.concept }
        if (c.localId !== undefined) cls.localId = c.localId
        if (c.label !== undefined) cls.label = c.label
        if (c.icon !== undefined) cls.icon = c.icon
        for (const [field, path] of [['templatePath', c.template], ['thumbnailPath', c.thumbnail], ['docPath', c.doc]] as const)
        {
            if (path === undefined) continue
            if (await backend.Exists(`${base}/${path}`)) (cls as unknown as Record<string, unknown>)[field] = path
            else problems.push({ severity: 'warning', uri: path, message: `Referenced resource is missing: ${path}` })
        }
        classes.push(cls)
    }
    return { id: manifest.id, version: manifest.version, name: manifest.name, metaModels: manifest.metaModels ?? [], classes, problems }
}

