import { deriveClasses as todlDeriveClasses, type PublishedClass as TodlPublishedClass, type TodlDocument } from '@pragmatic-tech-ai/todl'

import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

// One instantiable class a published library provides — a palette item. The
// model-derived fields (id/localId/label/icon/concept) come from TODL's
// PublishedClass; Plexus adds the bundle resource paths, attached later (present
// only when the conventionally-named file exists).
export interface PublishedClass extends TodlPublishedClass
{
    template?:  string     // "visuals/<id>.mural"    — present only if the file exists
    thumbnail?: string     // "thumbnails/<id>.png"   — present only if the file exists
    doc?:       string     // "docs/<id>.md"          — present only if the file exists
}

// The library.json bundle manifest — the index a consumer reads to discover and
// mount a published library. `classes` are the palette items; `assets`/`docs`/
// `samples` list every file under those bundle folders.
export interface LibraryBundleManifest
{
    id:          string
    version:     string
    name:        string
    description?: string
    metaModel:   { id: string; version: string }
    classes:     PublishedClass[]
    assets:      string[]
    docs:        string[]
    samples:     string[]
}

// The instantiable classes a library provides. The derivation (Instance-tier
// clabjects with `attrs.class === true`, label + annotation icon) now lives in
// TODL core (`deriveClasses`); this delegates and widens the result to the
// Plexus PublishedClass so resource paths can be attached at publish time.
export function deriveClasses(model: TodlDocument): PublishedClass[]
{
    return todlDeriveClasses(model)
}

export interface ScannedResources
{
    byClass:  Map<string, { template?: string; thumbnail?: string; doc?: string }>
    assets:   string[]
    docs:     string[]
    samples:  string[]
    warnings: string[]
}

// Scan the reserved resource folders and bind files to classes by filename
// convention (stem = class id): visuals/<id>.mural, thumbnails/<id>.png,
// docs/<id>.md attach to a known class; every asset/doc/sample file is also
// listed for the bundle manifest. A visuals/thumbnails file whose stem is not a
// known class id is an orphan — warned, never fatal. Folders are listed flat
// (Phase 1 assumes no nesting inside them); a missing folder lists as empty.
export async function scanResources(
    storage: IStorage,
    classIds: readonly string[],
): Promise<ScannedResources>
{
    const known = new Set(classIds)
    const byClass = new Map<string, { template?: string; thumbnail?: string; doc?: string }>()
    const warnings: string[] = []

    const ensure = (id: string): { template?: string; thumbnail?: string; doc?: string } => {
        let e = byClass.get(id)
        if (e === undefined) { e = {}; byClass.set(id, e) }
        return e
    }
    const files = async (dir: string): Promise<string[]> => {
        const names: string[] = []
        for (const e of await storage.List(dir)) if (!e.IsDirectory) names.push(e.Name)
        return names
    }
    const stem = (name: string): string => {
        const i = name.lastIndexOf('.')
        return i > 0 ? name.slice(0, i) : name
    }

    for (const name of await files('visuals')) {
        if (!name.endsWith('.mural')) continue
        const id = stem(name)
        if (known.has(id)) ensure(id).template = `visuals/${name}`
        else warnings.push(`visuals/${name} targets unknown class "${id}"`)
    }
    for (const name of await files('thumbnails')) {
        const id = stem(name)
        if (known.has(id)) ensure(id).thumbnail = `thumbnails/${name}`
        else warnings.push(`thumbnails/${name} targets unknown class "${id}"`)
    }
    for (const name of await files('docs')) {
        const id = stem(name)
        if (name.endsWith('.md') && known.has(id)) ensure(id).doc = `docs/${name}`
    }

    const assets  = (await files('assets')).map((n) => `assets/${n}`)
    const docs    = (await files('docs')).map((n) => `docs/${n}`)
    const samples = (await files('samples')).map((n) => `samples/${n}`)
    return { byClass, assets, docs, samples, warnings }
}
