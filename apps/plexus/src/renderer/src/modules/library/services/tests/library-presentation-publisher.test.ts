import { test, expect } from 'vitest'
import type { TodlDocument } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { publishLibraryPresentation } from '../library-presentation-publisher.js'

const DOC: TodlDocument = {
    nodes: [
        { id: 'microsoft.azure', tier: 'Instance', typeOf: 'location',
          attrs: { class: true, id: 'azure', label: 'Azure' } },
        { id: 'microsoft.azure@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'resources/azure.svg' } },
        { id: 'microsoft.aws', tier: 'Instance', typeOf: 'location', attrs: { class: true, id: 'aws', label: 'AWS' } },
    ],
    edges: [{ kind: 'Annotated', via: null, from: 'microsoft.azure', to: 'microsoft.azure@icon' }],
} as unknown as TodlDocument

const SVG = '<svg viewBox="0 0 16 16"><path d="M2 2 L14 2 L14 14 Z"/></svg>'
function project(withIcon = true): FakeStorage {
    const s = new FakeStorage('fake://proj')
    if (withIcon) void s.WriteText('resources/azure.svg', SVG)
    return s
}

test('writes an assets-only artifact (geometry inlined, no include, no templates) + icon-index', async () => {
    const dest = new FakeStorage('fake://backend')
    const res = await publishLibraryPresentation(project(), dest, 'microsoft/0.1.0', DOC)
    expect(res).toEqual({ ok: true, icons: 1 })
    expect(await dest.Exists('microsoft/0.1.0/presentation/presentation.compiled.json')).toBe(true)
    const art = JSON.parse(await dest.ReadText('microsoft/0.1.0/presentation/presentation.compiled.json'))
    expect(art.className).toBe('LibraryPresentation')
    expect(art.symbols).toContain('ResourceDictionary')
    expect(art.body).not.toContain('include ')
    expect(art.body).not.toContain('DataTemplate')   // assets only

    // icon-index keys by bare class id; the icon-less aws class is omitted.
    const idx = JSON.parse(await dest.ReadText('microsoft/0.1.0/presentation/icon-index.json'))
    expect(idx).toEqual({ 'microsoft.azure': 'mm_icon_azure' })
})

test('a referenced icon with no project file blocks publish (names the path, writes nothing)', async () => {
    const dest = new FakeStorage('fake://backend')
    const res = await publishLibraryPresentation(project(false), dest, 'microsoft/0.1.0', DOC)
    expect(res).toEqual({ ok: false, missing: ['resources/azure.svg'] })
    expect(await dest.Exists('microsoft/0.1.0/presentation/presentation.compiled.json')).toBe(false)
})

// A raster (PNG) class icon: the bytes are baked as a BitmapImage(data URI) — NOT
// run through the SVG geometry parser (which would throw on non-SVG) — and drawn by
// the default template's Image element.
const RASTER_DOC: TodlDocument = {
    nodes: [
        { id: 'microsoft.aml', tier: 'Instance', typeOf: 'technology',
          attrs: { class: true, id: 'aml', label: 'Azure ML' } },
        { id: 'microsoft.aml@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'resources/azure-machine-learning.png' } },
    ],
    edges: [{ kind: 'Annotated', via: null, from: 'microsoft.aml', to: 'microsoft.aml@icon' }],
} as unknown as TodlDocument

// 1x1 transparent PNG bytes.
const PNG = Uint8Array.from(atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
    (c) => c.charCodeAt(0))

test('a raster (PNG) icon is baked as a BitmapImage asset, and indexed like any icon', async () => {
    const proj = new FakeStorage('fake://proj')
    await proj.WriteBytes('resources/azure-machine-learning.png', PNG)
    const dest = new FakeStorage('fake://backend')
    const res = await publishLibraryPresentation(proj, dest, 'microsoft/0.1.0', RASTER_DOC)
    expect(res).toMatchObject({ ok: true, icons: 1 })
    const art = JSON.parse(await dest.ReadText('microsoft/0.1.0/presentation/presentation.compiled.json'))
    expect(art.body).toContain('new BitmapImage("data:image/png;base64,')
    expect(art.body).not.toContain('ImageBrush')   // drawn by an Image element, not a brush
    expect(art.symbols).toContain('BitmapImage')
    // Raster icons are indexed like vector ones; the default template's Image draws them.
    const idx = JSON.parse(await dest.ReadText('microsoft/0.1.0/presentation/icon-index.json'))
    expect(idx).toEqual({ 'microsoft.aml': 'mm_icon_azure_machine_learning' })
})

test('a referenced raster icon with no project file blocks publish', async () => {
    const dest = new FakeStorage('fake://backend')
    const res = await publishLibraryPresentation(new FakeStorage('fake://proj'), dest, 'microsoft/0.1.0', RASTER_DOC)
    expect(res).toEqual({ ok: false, missing: ['resources/azure-machine-learning.png'] })
})

test('a model with no icons still bakes a valid artifact', async () => {
    const noIcons: TodlDocument = {
        nodes: [{ id: 'microsoft.aws', tier: 'Instance', typeOf: 'location', attrs: { class: true, id: 'aws', label: 'AWS' } }],
        edges: [],
    } as unknown as TodlDocument
    const dest = new FakeStorage('fake://backend')
    const res = await publishLibraryPresentation(new FakeStorage('fake://proj'), dest, 'microsoft/0.1.0', noIcons)
    expect(res).toMatchObject({ ok: true, icons: 0 })
    const art = JSON.parse(await dest.ReadText('microsoft/0.1.0/presentation/presentation.compiled.json'))
    expect(art.body).not.toContain('DataTemplate')
})
