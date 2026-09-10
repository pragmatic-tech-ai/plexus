import { test, expect } from 'vitest'

import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { MetaModelNodeKind, type EntityRef } from '../meta-model-tree-node.js'
import { scanPublishedModels, buildCatalog, loadVersionEntities, type DeleteTarget } from '../meta-model-tree-builder.js'

const NO_ACTIVATE = (): void => {}
const NO_DELETE = (): void => {}

function backendWith(entries: Array<[string, string]>): FakeStorage
{
    const s = new FakeStorage('fake://meta-models')
    for (const [path, text] of entries) void s.WriteText(path, text)
    return s
}

// A serialized TodlDocument (toJSON shape) with two concepts and one relationship.
const MODEL_JSON = JSON.stringify({
    nodes: [
        { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: { label: 'Actor' } },
        { id: 'app-component', tier: 'Ontology', typeOf: 'concept', attrs: {} },
        { id: 'depends-on', tier: 'Ontology', typeOf: 'relationship', attrs: {} },
    ],
    edges: [],
})

test('scanPublishedModels groups by id and sorts versions numeric-aware', async () => {
    const storage = backendWith([
        ['m/0.10.0/model.json', '{}'],
        ['m/0.9.0/model.json', '{}'],
        ['enterprise/1.0.0/model.json', '{}'],
    ])
    const models = await scanPublishedModels(storage)
    expect(models.map((m) => m.id)).toEqual(['enterprise', 'm'])
    expect(models.find((m) => m.id === 'm')?.versions).toEqual(['0.9.0', '0.10.0'])
})

test('buildCatalog yields Model nodes with lazy Version children', async () => {
    const storage = backendWith([['tech/0.1.0/model.json', MODEL_JSON]])
    const nodes = await buildCatalog(storage, NO_ACTIVATE, NO_DELETE)

    expect(nodes).toHaveLength(1)
    expect(nodes[0].Kind).toBe(MetaModelNodeKind.Model)
    expect(nodes[0].Label).toBe('tech')
    const version = nodes[0].Children.Get(0)!
    expect(version.Kind).toBe(MetaModelNodeKind.Version)
    expect(version.Label).toBe('0.1.0')
    // Lazy → the version starts with its "Loading…" sentinel.
    expect(version.Children.Get(0)!.Label).toBe('Loading…')
})

test('buildCatalog wires ModelId/ModelVersion + DeleteCommand on Model and Version nodes', async () => {
    const storage = backendWith([
        ['a/1.0.0/model.json', '{"nodes":[],"edges":[]}'],
        ['a/1.1.0/model.json', '{"nodes":[],"edges":[]}'],
        ['b/1.0.0/model.json', '{"nodes":[],"edges":[]}'],
    ])

    const calls: DeleteTarget[] = []
    const nodes = await buildCatalog(storage, NO_ACTIVATE, (t) => calls.push(t))

    const a = nodes.find((n) => n.Label === 'a')!
    expect(a.ModelId).toBe('a')
    expect(a.DeleteCommand).toBeDefined()
    a.DeleteCommand!.Execute()
    expect(calls).toContainEqual({ id: 'a' })

    const v = a.Children.ToArray().find((c) => c.Label === '1.0.0')!
    expect(v.ModelId).toBe('a')
    expect(v.ModelVersion).toBe('1.0.0')
    expect(v.DeleteCommand).toBeDefined()
    v.DeleteCommand!.Execute()
    expect(calls).toContainEqual({ id: 'a', version: '1.0.0' })
})

test('loadVersionEntities groups entities by kind, non-empty groups only, labelled', async () => {
    const storage = backendWith([['tech/0.1.0/model.json', MODEL_JSON]])
    const groups = await loadVersionEntities(storage, 'tech', '0.1.0', NO_ACTIVATE)

    // Concepts + Relationships present; Taxonomies + Primitives omitted (empty).
    expect(groups.map((g) => g.Label)).toEqual(['Concepts', 'Relationships'])
    const concepts = groups[0]
    expect(concepts.Kind).toBe(MetaModelNodeKind.Group)
    // attrs.label wins; else humanize(id): 'app-component' → 'App Component'.
    expect(concepts.Children.Get(0)!.Label).toBe('Actor')
    expect(concepts.Children.Get(1)!.Label).toBe('App Component')
    expect(concepts.Children.Get(0)!.Kind).toBe(MetaModelNodeKind.Entity)
})

test('loadVersionEntities surfaces viewpoints in a Viewpoints group', async () => {
    // Viewpoints are Ontology-tier `viewpoint` nodes (published in model.json);
    // the tree must present them like any other ontology kind.
    const model = JSON.stringify({
        nodes: [
            { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} },
            { id: 'Model', tier: 'Ontology', typeOf: 'viewpoint', attrs: { namespace: 'tech' } },
            { id: 'Scenarios', tier: 'Ontology', typeOf: 'viewpoint', attrs: {} },
        ],
        edges: [],
    })
    const storage = backendWith([['tech/0.1.0/model.json', model]])
    const groups = await loadVersionEntities(storage, 'tech', '0.1.0', NO_ACTIVATE)

    const vp = groups.find((g) => g.Label === 'Viewpoints')
    expect(vp, 'a Viewpoints group is present').toBeDefined()
    expect(vp!.Kind).toBe(MetaModelNodeKind.Group)
    // No `label` attr → humanized id.
    expect(vp!.Children.ToArray().map((c) => c.Label)).toEqual(['Model', 'Scenarios'])
    expect(vp!.Children.Get(0)!.Kind).toBe(MetaModelNodeKind.Entity)
})

test('loadVersionEntities returns a "No entities" leaf for a model with none', async () => {
    const empty = JSON.stringify({ nodes: [], edges: [] })
    const storage = backendWith([['tech/0.1.0/model.json', empty]])
    const groups = await loadVersionEntities(storage, 'tech', '0.1.0', NO_ACTIVATE)
    expect(groups).toHaveLength(1)
    expect(groups[0].Label).toBe('No entities')
})

test('loadVersionEntities returns a "Failed to load model.json" leaf on bad json', async () => {
    const storage = backendWith([['tech/0.1.0/model.json', 'not json']])
    const groups = await loadVersionEntities(storage, 'tech', '0.1.0', NO_ACTIVATE)
    expect(groups).toHaveLength(1)
    expect(groups[0].Label).toBe('Failed to load model.json')
})

test('entity leaves carry an EntityRef wired to the activate callback', async () => {
    const storage = backendWith([['tech/0.1.0/model.json', MODEL_JSON]])
    const calls: EntityRef[] = []
    const groups = await loadVersionEntities(storage, 'tech', '0.1.0', (r) => calls.push(r))
    const concepts = groups.find((g) => g.Label === 'Concepts')!
    const actorNode = concepts.Children.Get(0)!   // 'Actor'
    actorNode.OnActivate()
    expect(calls).toEqual([{ modelId: 'tech', version: '0.1.0', id: 'actor' }])
})

test('a taxonomy row nests its terms as child entity rows', async () => {
    const model = JSON.stringify({
        nodes: [
            { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} },
            { id: 'actors', tier: 'Ontology', typeOf: 'taxonomy', attrs: { label: 'Actors' } },
            { id: 'actors.internal', tier: 'Instance', typeOf: 'actor', attrs: { class: true, id: 'internal', label: 'Internal' } },
        ],
        edges: [
            { kind: 'Contains', via: null, from: 'actors', to: 'actors.internal' },
        ],
    })
    const storage = backendWith([['tech/0.1.0/model.json', model]])

    const calls: EntityRef[] = []
    const groups = await loadVersionEntities(storage, 'tech', '0.1.0', (r) => calls.push(r))

    const taxGroup = groups.find((g) => g.Label === 'Taxonomies')!
    const taxRow = taxGroup.Children.Get(0)!            // the `actors` taxonomy row
    expect(taxRow.Label).toBe('Actors')
    const termRow = taxRow.Children.Get(0)!             // its nested term
    expect(termRow.Label).toBe('Internal')
    termRow.OnActivate()
    expect(calls).toEqual([{ modelId: 'tech', version: '0.1.0', id: 'actors.internal' }])
})
