import { test, expect } from 'vitest'
import type { TodlDocument } from '@pragmatic-tech-ai/todl'

import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { publishPresentation } from '../presentation-publisher.js'

const DOC: TodlDocument = {
    nodes: [
        { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: { label: 'Actor' } },
        { id: 'actor@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'resources/actor.svg' } },
        { id: 'component', tier: 'Ontology', typeOf: 'concept', attrs: {} },
        { id: 'depends-on', tier: 'Ontology', typeOf: 'relationship', attrs: {} },
    ],
    edges: [{ kind: 'Annotated', via: null, from: 'actor', to: 'actor@icon' }],
} as unknown as TodlDocument

const SVG = '<svg viewBox="0 0 16 16"><path d="M2 2 L14 2 L14 14 Z"/></svg>'

function project(withIcon = true): FakeStorage {
    const s = new FakeStorage('fake://proj')
    if (withIcon) void s.WriteText('resources/actor.svg', SVG)
    return s
}

test('writes an assets-only compiled artifact (no templates, no raw .mu or SVGs)', async () => {
    const proj = project()
    const dest = new FakeStorage('fake://backend')
    const res = await publishPresentation(proj, dest, 'ea/1.0.0', DOC)
    expect(res.ok).toBe(true)

    expect(await dest.Exists('ea/1.0.0/presentation/presentation.compiled.json')).toBe(true)
    expect(await dest.Exists('ea/1.0.0/presentation/resources/actor.svg')).toBe(false)
    expect(await proj.Exists('presentation/templates.mu')).toBe(false)   // no scaffolding

    const art = JSON.parse(await dest.ReadText('ea/1.0.0/presentation/presentation.compiled.json'))
    expect(art.className).toBe('MetaModelPresentation')
    expect(art.symbols).toContain('ResourceDictionary')
    expect(typeof art.body).toBe('string')
    expect(art.body).not.toContain('include ')      // geometry inlined
    expect(art.body).not.toContain('DataTemplate')  // assets only
})

test('reports the icon count and writes the icon-index sidecar', async () => {
    const dest = new FakeStorage('fake://backend')
    const res = await publishPresentation(project(), dest, 'ea/1.0.0', DOC)
    expect(res).toEqual({ ok: true, icons: 1 })

    const idx = JSON.parse(await dest.ReadText('ea/1.0.0/presentation/icon-index.json'))
    expect(idx).toEqual({ 'mm:actor': 'mm_icon_actor' })
})

test('a referenced icon with no project file blocks publish (names the path, writes nothing)', async () => {
    const dest = new FakeStorage('fake://backend')
    const res = await publishPresentation(project(false), dest, 'ea/1.0.0', DOC)
    expect(res).toEqual({ ok: false, missing: ['resources/actor.svg'] })
    expect(await dest.Exists('ea/1.0.0/presentation/presentation.compiled.json')).toBe(false)
    expect(await dest.Exists('ea/1.0.0/presentation/icon-index.json')).toBe(false)
})

test('a model with no icons still publishes a valid assets artifact + empty index', async () => {
    const noIcons: TodlDocument = {
        nodes: [{ id: 'component', tier: 'Ontology', typeOf: 'concept', attrs: {} }], edges: [],
    } as unknown as TodlDocument
    const dest = new FakeStorage('fake://backend')
    const res = await publishPresentation(new FakeStorage('fake://proj'), dest, 'ea/1.0.0', noIcons)
    expect(res).toEqual({ ok: true, icons: 0 })
    const art = JSON.parse(await dest.ReadText('ea/1.0.0/presentation/presentation.compiled.json'))
    expect(art.body).not.toContain('DataTemplate')
    const idx = JSON.parse(await dest.ReadText('ea/1.0.0/presentation/icon-index.json'))
    expect(idx).toEqual({})
})
