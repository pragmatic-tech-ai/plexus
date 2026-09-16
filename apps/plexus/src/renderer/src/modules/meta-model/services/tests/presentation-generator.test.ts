import { test, expect } from 'vitest'
import type { TodlDocument } from '@pragmatic-tech-ai/todl'

import { iconKey, humanize, ontologyEntities, classEntities, distinctIcons, generatePresentationAssets, isRasterIcon, includeLine, resolveFacets, assignResourceKeys, resourceKeyFor, stampResourceKeys, buildIconIndex } from '../presentation-generator.js'

function doc(nodes: TodlDocument['nodes']): TodlDocument { return { nodes, edges: [] } }

// An `<x>@icon` annotation application node — the sole icon source now that the
// legacy `attrs.icon` field form is gone.
function iconNode(id: string, path: string): TodlDocument['nodes'][number] {
    return { id, tier: 'Ontology', typeOf: 'icon', attrs: { path } } as unknown as TodlDocument['nodes'][number]
}

test('iconKey slugs an icon path to a stable identifier', () => {
    expect(iconKey('resources/actor-internal.svg')).toBe('mm_icon_actor_internal')
    expect(iconKey('resources/sub/role.service.svg')).toBe('mm_icon_role_service')
    expect(iconKey('a.svg')).toBe('mm_icon_a')
})

test('humanize title-cases an id split on - and .', () => {
    expect(humanize('app-component')).toBe('App Component')
    expect(humanize('actor')).toBe('Actor')
    expect(humanize('connector-type-style')).toBe('Connector Type Style')
})

test('isRasterIcon detects bitmap extensions, not svg', () => {
    expect(isRasterIcon('resources/logo.png')).toBe(true)
    expect(isRasterIcon('resources/logo.JPG')).toBe(true)
    expect(isRasterIcon('resources/a.svg')).toBe(false)
})

test('includeLine: colored mode uses `colored` for SVG, plain for raster', () => {
    expect(includeLine('resources/a.svg', 'mm_icon_a', true)).toBe('    include colored "resources/a.svg" as mm_icon_a')
    expect(includeLine('resources/a.png', 'mm_icon_a', true)).toBe('    include "resources/a.png" as mm_icon_a')
})

test('includeLine: monochrome mode uses a plain include for SVG too', () => {
    expect(includeLine('resources/a.svg', 'mm_icon_a', false)).toBe('    include "resources/a.svg" as mm_icon_a')
    expect(includeLine('resources/a.png', 'mm_icon_a', false)).toBe('    include "resources/a.png" as mm_icon_a')
})

test('ontologyEntities keeps concept/relationship/taxonomy/viewpoint/primitive, drops field + instances', () => {
    const m = doc([
        { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} },
        { id: 'depends-on', tier: 'Ontology', typeOf: 'relationship', attrs: {} },
        { id: 'actor-kind', tier: 'Ontology', typeOf: 'taxonomy', attrs: {} },
        { id: 'Model', tier: 'Ontology', typeOf: 'viewpoint', attrs: {} },
        { id: 'text', tier: 'Ontology', typeOf: 'primitive', attrs: {} },
        { id: 'actor.label', tier: 'Ontology', typeOf: 'field', attrs: {} },
        { id: 'actors.internal', tier: 'Instance', typeOf: 'actor', attrs: {} },
    ])
    expect(ontologyEntities(m).map((n) => n.id)).toEqual(['actor', 'depends-on', 'actor-kind', 'Model', 'text'])
})

test('distinctIcons collects distinct annotation icon paths, sorted', () => {
    const m = doc([
        iconNode('a@icon', 'resources/b.svg'),
        iconNode('b@icon', 'resources/a.svg'),
        iconNode('c@icon', 'resources/b.svg'),   // dup path
        { id: 'd', tier: 'Ontology', typeOf: 'concept', attrs: {} },
    ])
    expect(distinctIcons(m)).toEqual(['resources/a.svg', 'resources/b.svg'])
})

test('distinctIcons ignores a raw attrs.icon field (annotation form only)', () => {
    const m = doc([
        { id: 'a', tier: 'Ontology', typeOf: 'concept', attrs: { icon: 'resources/legacy.svg' } },
        iconNode('b@icon', 'resources/b.svg'),
    ])
    expect(distinctIcons(m)).toEqual(['resources/b.svg'])
})

test('classEntities returns Instance-tier class nodes only', () => {
    const m = doc([
        { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} },
        { id: 'actors.internal', tier: 'Instance', typeOf: 'actor', attrs: { class: true, id: 'internal' } },
        { id: 'web-app', tier: 'Instance', typeOf: 'component', attrs: { class: true, id: 'web-app' } },
        { id: 'storefront', tier: 'Instance', typeOf: 'component', attrs: {} },   // concrete, not a class
    ])
    expect(classEntities(m).map((n) => n.id)).toEqual(['actors.internal', 'web-app'])
})

test('resolveFacets: icon comes from the annotation only; label is attr-primary', () => {
    const node = { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: { icon: 'a.svg', label: 'Attr' } } as unknown as import('@pragmatic-tech-ai/todl').JsonNode
    // The attrs.icon field is ignored; the annotation supplies the icon. Label still prefers the attr.
    expect(resolveFacets(node, { icon: { path: 'ann.svg' }, label: { text: 'Ann' } })).toEqual({ icon: 'ann.svg', label: 'Attr' })
})

test('resolveFacets: no icon when the annotation is absent, even with a raw attrs.icon', () => {
    const node = { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: { icon: 'a.svg' } } as unknown as import('@pragmatic-tech-ai/todl').JsonNode
    expect(resolveFacets(node, {})).toEqual({ icon: undefined, label: 'Actor' })
})

test('resolveFacets: annotation icon + annotation label when no attr label present', () => {
    const node = { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} } as unknown as import('@pragmatic-tech-ai/todl').JsonNode
    expect(resolveFacets(node, { icon: { path: 'ann.svg' }, label: { text: 'Ann' } })).toEqual({ icon: 'ann.svg', label: 'Ann' })
})

test('resolveFacets: humanize label and no icon when neither present', () => {
    const node = { id: 'app-component', tier: 'Ontology', typeOf: 'concept', attrs: {} } as unknown as import('@pragmatic-tech-ai/todl').JsonNode
    expect(resolveFacets(node, {})).toEqual({ icon: undefined, label: 'App Component' })
})

// ── generatePresentationAssets — assets-only, no DataTemplates ────────────────

test('generatePresentationAssets emits icon includes only — no DataTemplates, no merges', () => {
    const m = doc([
        iconNode('app-component@icon', 'resources/comp.svg'),
        iconNode('actor@icon', 'resources/actor.svg'),
    ])
    const out = generatePresentationAssets(m, 'MetaModelPresentation', true)
    expect(out).toMatch(/resources MetaModelPresentation \{/)
    expect(out).toContain('include colored "resources/actor.svg" as mm_icon_actor')
    expect(out).toContain('include colored "resources/comp.svg" as mm_icon_comp')
    expect(out).toMatch(/Embedded content \(base64\)/) // reserved seam
    expect(out).not.toContain('DataTemplate') // templates are author-owned now
    expect(out).not.toContain('merge ')       // author templates are inlined by the publisher, not merged
    // deterministic: actor include precedes comp include (sorted)
    expect(out.indexOf('mm_icon_actor')).toBeLessThan(out.indexOf('mm_icon_comp'))
})

test('generatePresentationAssets includes annotation-sourced icons', () => {
    const m = {
        nodes: [
            { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} },
            { id: 'actor@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'resources/actor.svg' } },
        ],
        edges: [{ kind: 'Annotated', via: null, from: 'actor', to: 'actor@icon' }],
    } as unknown as TodlDocument
    const out = generatePresentationAssets(m, 'MetaModelPresentation', true)
    expect(out).toContain('include colored "resources/actor.svg" as mm_icon_actor')
    expect(out).not.toContain('DataTemplate')
})

test('generatePresentationAssets in monochrome mode emits plain includes (no `colored`)', () => {
    const m = doc([iconNode('actor@icon', 'resources/actor.svg')])
    const out = generatePresentationAssets(m, 'MetaModelPresentation', false)
    expect(out).toContain('include "resources/actor.svg" as mm_icon_actor')
    expect(out).not.toContain('include colored')
})

test('generatePresentationAssets is deterministic', () => {
    const m = doc([{ id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} }])
    const a = generatePresentationAssets(m, 'LibraryPresentation', true)
    const b = generatePresentationAssets(m, 'LibraryPresentation', true)
    expect(a).toBe(b)
    expect(a).toMatch(/resources LibraryPresentation \{/)
})

test('assignResourceKeys gives distinct stems their base iconKey, sorted', () => {
    const m = doc([
        iconNode('a@icon', 'resources/comp.svg'),
        iconNode('b@icon', 'resources/actor.svg'),
    ])
    expect([...assignResourceKeys(m)]).toEqual([
        ['resources/actor.svg', 'mm_icon_actor'],
        ['resources/comp.svg', 'mm_icon_comp'],
    ])
})

test('assignResourceKeys suffixes colliding stems _2, _3 in sorted-path order', () => {
    const m = doc([
        iconNode('a@icon', 'a/az.svg'),
        iconNode('b@icon', 'b/az.svg'),
        iconNode('c@icon', 'c/az.svg'),
        iconNode('d@icon', 'x/other.svg'),
    ])
    const keys = assignResourceKeys(m)
    expect(keys.get('a/az.svg')).toBe('mm_icon_az')
    expect(keys.get('b/az.svg')).toBe('mm_icon_az_2')
    expect(keys.get('c/az.svg')).toBe('mm_icon_az_3')
    expect(keys.get('x/other.svg')).toBe('mm_icon_other')
})

test('resourceKeyFor returns the assigned (possibly suffixed) key', () => {
    const m = doc([
        iconNode('a@icon', 'a/az.svg'),
        iconNode('b@icon', 'b/az.svg'),
    ])
    expect(resourceKeyFor(m, 'a/az.svg')).toBe('mm_icon_az')
    expect(resourceKeyFor(m, 'b/az.svg')).toBe('mm_icon_az_2')
})

test('generatePresentationAssets suffixes colliding icon stems in its includes', () => {
    const m = doc([
        iconNode('a@icon', 'a/az.svg'),
        iconNode('b@icon', 'b/az.svg'),
    ])
    const out = generatePresentationAssets(m, 'MetaModelPresentation', true)
    expect(out).toContain('include colored "a/az.svg" as mm_icon_az')
    expect(out).toContain('include colored "b/az.svg" as mm_icon_az_2')
})

// ── buildIconIndex — entityKey → icon resource key ───────────────────────────

test('buildIconIndex maps each icon-bearing entity to its resource key under the prefix', () => {
    const m = {
        nodes: [
            { id: 'service', tier: 'Ontology', typeOf: 'concept', attrs: {} },
            { id: 'service@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'resources/svc.svg' } },
            { id: 'db', tier: 'Instance', typeOf: 'component', attrs: { class: true, id: 'db' } },
            { id: 'db@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'resources/db.svg' } },
            { id: 'plain', tier: 'Ontology', typeOf: 'concept', attrs: {} },   // no icon → omitted
        ],
        edges: [
            { kind: 'Annotated', via: null, from: 'service', to: 'service@icon' },
            { kind: 'Annotated', via: null, from: 'db', to: 'db@icon' },
        ],
    } as unknown as TodlDocument
    const idx = buildIconIndex(m, 'mm:')
    expect(idx.get('mm:service')).toBe('mm_icon_svc')
    expect(idx.get('mm:db')).toBe('mm_icon_db')
    expect(idx.has('mm:plain')).toBe(false)
})

test('buildIconIndex indexes raster (PNG) icons too — they render via the Image element', () => {
    const m = {
        nodes: [
            { id: 'aml', tier: 'Instance', typeOf: 'component', attrs: { class: true, id: 'aml' } },
            { id: 'aml@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'resources/aml.png' } },
        ],
        edges: [{ kind: 'Annotated', via: null, from: 'aml', to: 'aml@icon' }],
    } as unknown as TodlDocument
    const idx = buildIconIndex(m, 'mm:')
    expect(idx.get('mm:aml')).toBe('mm_icon_aml')
})

test('buildIconIndex applies an empty prefix for the library keyspace', () => {
    const m = {
        nodes: [
            { id: 'service', tier: 'Ontology', typeOf: 'concept', attrs: {} },
            { id: 'service@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'resources/svc.svg' } },
        ],
        edges: [{ kind: 'Annotated', via: null, from: 'service', to: 'service@icon' }],
    } as unknown as TodlDocument
    const idx = buildIconIndex(m, '')
    expect(idx.get('service')).toBe('mm_icon_svc')
})

test('stampResourceKeys writes the assigned key onto icon application nodes only', () => {
    const m = {
        nodes: [
            { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} },
            { id: 'actor@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'a/az.svg' } },
            { id: 'comp@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'b/az.svg' } },
            { id: 'raw', tier: 'Instance', typeOf: 'x', attrs: { icon: 'c/other.svg' } }, // raw attr, not an app
        ],
        edges: [],
    } as unknown as TodlDocument
    stampResourceKeys(m)
    const byId = (id: string) => m.nodes.find((n) => n.id === id)!.attrs as Record<string, unknown>
    expect(byId('actor@icon')['key']).toBe('mm_icon_az')
    expect(byId('comp@icon')['key']).toBe('mm_icon_az_2') // collision-aware, shares the assignment
    expect(byId('raw')['key']).toBeUndefined()            // raw attrs.icon node is not stamped
    expect(byId('actor')['key']).toBeUndefined()          // non-icon node untouched
})
