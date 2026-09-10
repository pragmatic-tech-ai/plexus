// library-presentation-publisher.ts — compile the library's presentation once and
// bake it into the bundle as presentation.compiled.json (geometry inlined, imports
// stripped), mirroring meta-model/services/presentation-publisher.ts. Templates are
// AUTHOR-owned (presentation/*.mu): missing stubs are scaffolded write-once and the
// author DataTemplates are inlined into the single assets block. A referenced icon
// with no project file blocks publish (nothing written).
import type { TodlDocument } from '@pragmatic-tech-ai/todl'
import { compile, DEFAULT_SYMBOLS } from '@pragmatic-tech-ai/mural/compiler'

import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import {
    type CompiledPresentation, combinedSource, ICON_INDEX_FILE, readIcons, iconIncludeResolver,
} from '../../meta-model/services/presentation-publisher.js'
import { buildIconIndex } from '../../meta-model/services/presentation-generator.js'

const PRESENTATION_DIR = 'presentation'
const COMPILED_FILE = 'presentation.compiled.json'
const DICT_NAME = 'LibraryPresentation'

export type PublishLibraryPresentationResult =
    | { ok: true; icons: number }
    | { ok: false; missing: string[] }

// Assets-only, mirroring the meta-model publisher: bake one asset per distinct icon
// (SVG → colored IconDefinition, raster → BitmapImage) plus an icon-index.json
// (classId → resource key). No DataTemplates; classes render through Plexus's one
// default template. A referenced icon with no project file blocks publish (nothing
// written).
export async function publishLibraryPresentation(
    project: IStorage, dest: IStorage, base: string, doc: TodlDocument,
): Promise<PublishLibraryPresentationResult>
{
    // Pre-read every referenced icon (compiler include resolution is sync): SVGs as
    // text (→ IconDefinition), raster images as data URIs (→ BitmapImage).
    const { svgByPath, rasterUriByPath, missing } = await readIcons(project, doc)
    if (missing.length > 0) return { ok: false, missing }

    const source = combinedSource(doc, DICT_NAME, [])
    const include = iconIncludeResolver(svgByPath, rasterUriByPath)
    const result = compile(source, { include, symbols: new Map(DEFAULT_SYMBOLS) })

    const names = new Set<string>()
    for (const set of result.imports.values()) for (const n of set) names.add(n)
    const className = result.resourcesBlocks?.[0]?.name
    if (className === undefined) throw new Error('library presentation compile produced no resources block')

    const body = result.js.split('\n').filter((l) => !/^import\b.*\bfrom\b/.test(l)).join('\n').trim()
    const artifact: CompiledPresentation = { body, symbols: [...names].sort(), className }
    await dest.WriteText(`${base}/${PRESENTATION_DIR}/${COMPILED_FILE}`, JSON.stringify(artifact))

    // Sidecar: classId → icon resource key (library keyspace, no prefix).
    await dest.WriteText(
        `${base}/${PRESENTATION_DIR}/${ICON_INDEX_FILE}`,
        JSON.stringify(Object.fromEntries(buildIconIndex(doc, ''))),
    )

    return { ok: true, icons: svgByPath.size + rasterUriByPath.size }
}
