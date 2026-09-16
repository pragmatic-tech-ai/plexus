import type { TodlDocument } from '@pragmatic-tech-ai/todl'
import {
    compile, DEFAULT_SYMBOLS, svgToGeometryJs,
    type IncludeResolver, type IncludeResolution,
} from '@pragmatic-tech-ai/mural/compiler'

import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { distinctIcons, assignResourceKeys, buildIconIndex, isRasterIcon, includeLine } from './presentation-generator.js'

const PRESENTATION_DIR = 'presentation'
const COMPILED_FILE = 'presentation.compiled.json'
export const ICON_INDEX_FILE = 'icon-index.json'
const BASIC = '@pragmatic-tech-ai/mural/basic'
const VISUAL_ENGINE = '@pragmatic-tech-ai/mural/visual-engine'
const DICT_NAME = 'MetaModelPresentation'

// Raster icon extensions → MIME type for the baked data URI.
const RASTER_MIME: Readonly<Record<string, string>> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
}

function mimeOf(path: string): string
{
    const dot = path.lastIndexOf('.')
    return (dot >= 0 ? RASTER_MIME[path.slice(dot).toLowerCase()] : undefined) ?? 'application/octet-stream'
}

// Base64-encode bytes without Buffer (renderer + node both have btoa). Chunked so a
// large image never overflows the argument list of String.fromCharCode.
function bytesToBase64(bytes: Uint8Array): string
{
    let bin = ''
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
    return btoa(bin)
}

// The pre-read icon content for a doc: SVGs as text (→ colored IconDefinition) and
// raster images as base64 data URIs (→ BitmapImage). `missing` names every
// referenced icon with no readable project file. Shared by both publishers so
// meta-model and library bake raster identically.
export interface ReadIconsResult { svgByPath: Map<string, string>; rasterUriByPath: Map<string, string>; missing: string[] }

export async function readIcons(project: IStorage, doc: TodlDocument): Promise<ReadIconsResult>
{
    const svgByPath = new Map<string, string>()
    const rasterUriByPath = new Map<string, string>()
    const missing: string[] = []
    for (const path of distinctIcons(doc)) {
        if (isRasterIcon(path)) {
            try { rasterUriByPath.set(path, `data:${mimeOf(path)};base64,${bytesToBase64(await project.ReadBytes(path))}`) }
            catch { missing.push(path) }
        } else {
            try { svgByPath.set(path, await project.ReadText(path)) }
            catch { missing.push(path) }
        }
    }
    return { svgByPath, rasterUriByPath, missing }
}

// Compiler include resolver over pre-read icon content, honoring the `colored` flag
// the markup carries. An SVG under `include colored` bakes to `parseSvgIcon(text)` —
// a COLORED IconDefinition that KEEPS the currentColor sentinel, so a monochrome
// (currentColor / gradient / unspecified-fill) icon themes to the Icon's Foreground
// instead of a baked black, while an explicit-color icon paints its own colors. A
// plain `include` bakes monochrome geometry (svgToGeometryJs). A raster bakes to a
// BitmapImage over an inline data URI. The default template draws an IconDefinition
// through its Icon and a BitmapImage through its Image — no external file dependency.
//
// NB: parseSvgIcon runs at load, not bake time. The framework's svgToIconJs bakes the
// geometry inline but serializes currentColor to opaque black — wrong for currentColor
// icon sets (Fabric etc.), so it is intentionally NOT used here.
export function iconIncludeResolver(svgByPath: Map<string, string>, rasterUriByPath: Map<string, string>): IncludeResolver
{
    return (path, ctx): IncludeResolution => {
        if (isRasterIcon(path)) {
            const uri = rasterUriByPath.get(path)
            if (uri === undefined) throw new Error(`presentation raster include not pre-read: ${path}`)
            return {
                entries: [{ key: ctx.key ?? path, valueJs: `new BitmapImage(${JSON.stringify(uri)})` }],
                imports: [{ module: VISUAL_ENGINE, names: ['BitmapImage'] }],
            }
        }
        const text = svgByPath.get(path)
        if (text === undefined) throw new Error(`presentation include not pre-read: ${path}`)
        if (ctx.colored) {
            return {
                entries: [{ key: ctx.key ?? path, valueJs: `parseSvgIcon(${JSON.stringify(text)})` }],
                imports: [{ module: BASIC, names: ['parseSvgIcon'] }],
            }
        }
        const { valueJs, names } = svgToGeometryJs(text)
        return { entries: [{ key: ctx.key ?? path, valueJs }], imports: [{ module: VISUAL_ENGINE, names }] }
    }
}

// The self-contained, evaluable presentation payload written into the backend.
// `body` is the compiled resources class (geometry inlined, imports stripped);
// `symbols` are the names the loader destructures from its ctx; `className` is
// the resources block to instantiate.
export interface CompiledPresentation { body: string; symbols: string[]; className: string }

export type PublishPresentationResult =
    | { ok: true; icons: number }
    | { ok: false; missing: string[] }

// Compile the meta-model's presentation once and write it into `dest` under
// `<base>/presentation/presentation.compiled.json`. The artifact is ASSETS ONLY:
// one baked icon asset per distinct icon (SVG → colored IconDefinition, raster →
// BitmapImage), keyed by its resource key. No DataTemplates — every entity renders
// through Plexus's one default template, which draws the icon named by
// `icon-index.json` (entityKey → resourceKey). Icon content is embedded, so the
// artifact has no external file dependency. A referenced icon with no project file
// blocks the publish (nothing is written).
export async function publishPresentation(
    project: IStorage, dest: IStorage, base: string, doc: TodlDocument,
): Promise<PublishPresentationResult>
{
    // Pre-read every referenced icon (compiler include resolution is sync).
    const { svgByPath, rasterUriByPath, missing } = await readIcons(project, doc)
    if (missing.length > 0) return { ok: false, missing }

    const source = combinedSource(doc, DICT_NAME, [])
    const include = iconIncludeResolver(svgByPath, rasterUriByPath)
    const result = compile(source, { include, symbols: new Map(DEFAULT_SYMBOLS) })

    const names = new Set<string>()
    for (const set of result.imports.values()) for (const n of set) names.add(n)
    const className = result.resourcesBlocks?.[0]?.name
    if (className === undefined) throw new Error('presentation compile produced no resources block')

    const body = result.js.split('\n').filter((l) => !/^import\b.*\bfrom\b/.test(l)).join('\n').trim()
    const artifact: CompiledPresentation = { body, symbols: [...names].sort(), className }
    await dest.WriteText(`${base}/${PRESENTATION_DIR}/${COMPILED_FILE}`, JSON.stringify(artifact))

    // Sidecar: entityKey → icon resource key, so load never re-derives keys.
    await dest.WriteText(
        `${base}/${PRESENTATION_DIR}/${ICON_INDEX_FILE}`,
        JSON.stringify(Object.fromEntries(buildIconIndex(doc, 'mm:'))),
    )

    return { ok: true, icons: svgByPath.size + rasterUriByPath.size }
}

// One self-contained assets `resources` block: icon includes the compiler bakes
// into IconDefinition/BitmapImage resources keyed by resource key. `authorInners` is
// kept for signature compatibility but is always empty now (no author templates).
// Shared with the library publisher.
export function combinedSource(doc: TodlDocument, dictName: string, authorInners: readonly string[]): string
{
    // Publish always bakes colored — the compiled runtime artifact keeps each icon's
    // own colors; the Generate command's monochrome mode is for the inspection .mu only.
    const includes = [...assignResourceKeys(doc)].map(([p, k]) => includeLine(p, k, true))
    return [
        `resources ${dictName} {`,
        ...includes,
        ...authorInners.map((inner) => `    ${inner}`),
        '}',
    ].join('\n')
}
