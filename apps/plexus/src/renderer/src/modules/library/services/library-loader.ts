import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

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
    id:        string
    version:   string
    name:      string
    metaModel: { id: string; version: string }
    classes:   LoadedClass[]
    problems:  LoadProblem[]
}

// Every published <id>/<version> under the backend, loaded. Directory layout is
// the Phase-1 publish layout: root dirs are ids, each id's dirs are versions.
export async function discoverLibraries(backend: IStorage): Promise<LoadedLibrary[]>
{
    const out: LoadedLibrary[] = []
    const ids = (await backend.List('')).filter((e) => e.IsDirectory).map((e) => e.Name).sort()
    for (const id of ids) {
        const versions = (await backend.List(id)).filter((e) => e.IsDirectory).map((e) => e.Name).sort()
        for (const version of versions) out.push(await loadLibrary(backend, id, version))
    }
    return out
}

// Load one library's manifest into a LoadedLibrary. A malformed/unreadable
// manifest yields empty classes + one error problem (never throws). A class that
// cites a template/thumbnail/doc file with no file on disk records a warning.
export async function loadLibrary(backend: IStorage, id: string, version: string): Promise<LoadedLibrary>
{
    const base = `${id}/${version}`
    const problems: LoadProblem[] = []
    let manifest: {
        id: string; version: string; name: string
        metaModel: { id: string; version: string }
        classes: Array<{ id: string; localId?: string; label?: string; concept: string; template?: string; thumbnail?: string; doc?: string; icon?: string }>
    }
    try {
        manifest = JSON.parse(await backend.ReadText(`${base}/library.json`))
    } catch (e) {
        return { id, version, name: id, metaModel: { id: '', version: '' }, classes: [],
                 problems: [{ severity: 'error', uri: 'library.json', message: `Library manifest is invalid: ${(e as Error).message}` }] }
    }

    const classes: LoadedClass[] = []
    for (const c of manifest.classes ?? []) {
        const cls: LoadedClass = { id: c.id, concept: c.concept }
        if (c.localId !== undefined) cls.localId = c.localId
        if (c.label !== undefined) cls.label = c.label
        if (c.icon !== undefined) cls.icon = c.icon
        for (const [field, path] of [['templatePath', c.template], ['thumbnailPath', c.thumbnail], ['docPath', c.doc]] as const) {
            if (path === undefined) continue
            if (await backend.Exists(`${base}/${path}`)) (cls as unknown as Record<string, unknown>)[field] = path
            else problems.push({ severity: 'warning', uri: path, message: `Referenced resource is missing: ${path}` })
        }
        classes.push(cls)
    }
    return { id: manifest.id, version: manifest.version, name: manifest.name, metaModel: manifest.metaModel, classes, problems }
}

