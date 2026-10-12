import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { DiagramDocument } from '@pragmatic-tech-ai/mural/framework'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'
import { ArchNodeVM } from '../arch-node-vm.js'
import { ArchDiagramIdMigration } from '../arch-diagram-id-migration.js'
import { ARCH_CONNECTOR_VISUALS_KEY } from '../arch-diagram-connector-visuals-store.js'

// --- QualifiedIdFor: the pure bare/partial -> qualified mapping ---

const IDS = new Set<string>([
    'proj.models.teams',
    'proj.models.m365_copilot',
    'libraries.microsoft.microsoft_tech.m365_copilot',
    'libraries.evelyn.evelyn_actors.evelyn_business_user',
    'tech_architecture.actors.administration',
])

test('a bare own-instance name qualifies with the project namespace', () => {
    expect(ArchDiagramIdMigration.QualifiedIdFor('teams', IDS, 'proj.models')).toBe('proj.models.teams')
})

test('own-instance namespace prefix wins over a same-named library term', () => {
    // m365_copilot exists both as an own instance and a library tech term.
    expect(ArchDiagramIdMigration.QualifiedIdFor('m365_copilot', IDS, 'proj.models')).toBe('proj.models.m365_copilot')
})

test('a partially-qualified library ref resolves by unique suffix', () => {
    expect(ArchDiagramIdMigration.QualifiedIdFor('evelyn_actors.evelyn_business_user', IDS, 'proj.models'))
        .toBe('libraries.evelyn.evelyn_actors.evelyn_business_user')
    expect(ArchDiagramIdMigration.QualifiedIdFor('actors.administration', IDS, 'proj.models'))
        .toBe('tech_architecture.actors.administration')
})

test('an already-qualified id is left alone (returns undefined)', () => {
    expect(ArchDiagramIdMigration.QualifiedIdFor('proj.models.teams', IDS, 'proj.models')).toBeUndefined()
})

test('an unresolvable / freeform id returns undefined', () => {
    expect(ArchDiagramIdMigration.QualifiedIdFor('n3', IDS, 'proj.models')).toBeUndefined()
    expect(ArchDiagramIdMigration.QualifiedIdFor('media-xyz', IDS, 'proj.models')).toBeUndefined()
})

test('an ambiguous bare suffix (no ns-prefix match, >1 suffix) returns undefined', () => {
    const ambiguous = new Set<string>(['a.ns.thing', 'b.ns.thing'])
    expect(ArchDiagramIdMigration.QualifiedIdFor('thing', ambiguous, 'proj.models')).toBeUndefined()
})

// --- Migrate: rewrites node ids, geometry keys, parentId, and connectorVisuals keys ---

const MM = `namespace archmm {
  concept component {}
  viewpoint ComponentView : frames component
}`
function buildModel(): ArchModel
{
    const draft = ModelDraft.fromSources(
        [new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))],
        [], { namespace: 'archmm' })
    const model = new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
    // Two own instances: archmm.component1, archmm.component2.
    model.createInViewpoint('archmm.component', 'archmm.ComponentView')
    model.createInViewpoint('archmm.component', 'archmm.ComponentView')
    return model
}

test('Migrate qualifies stale node ids, preserves geometry, and reports a change', () => {
    const model = buildModel()
    const doc = new DiagramDocument()
    const a = new ArchNodeVM(); a.Id = 'component1'; doc.Nodes.Add(a)
    const b = new ArchNodeVM(); b.Id = 'component2'; doc.Nodes.Add(b)
    doc.SetNodeVisual('component1', { left: 10, top: 20, w: 100, h: 50 })
    doc.SetNodeVisual('component2', { left: 200, top: 20, w: 100, h: 50, parentId: 'component1' })

    const changed = ArchDiagramIdMigration.Migrate(doc, model)

    expect(changed).toBe(true)
    expect(a.Id).toBe('archmm.component1')
    expect(b.Id).toBe('archmm.component2')
    // Geometry followed the rename.
    expect(doc.GetNodeVisual('archmm.component1')).toMatchObject({ left: 10, top: 20 })
    expect(doc.GetNodeVisual('archmm.component2')).toMatchObject({ left: 200 })
    // parentId remapped too.
    expect(doc.GetNodeVisual('archmm.component2')?.parentId).toBe('archmm.component1')
})

test('Migrate remaps connectorVisuals edge keys at both endpoints', () => {
    const model = buildModel()
    const doc = new DiagramDocument()
    const a = new ArchNodeVM(); a.Id = 'component1'; doc.Nodes.Add(a)
    const b = new ArchNodeVM(); b.Id = 'component2'; doc.Nodes.Add(b)
    doc.Metadata = { ...doc.Metadata, [ARCH_CONNECTOR_VISUALS_KEY]: {
        'component1|__connector_entity__:calls|component2': { routingMode: 'orthogonal' },
        'component2|__scenario_step__|component2': { zIndex: 3 },
    } }

    ArchDiagramIdMigration.Migrate(doc, model)

    const cv = doc.Metadata[ARCH_CONNECTOR_VISUALS_KEY] as Record<string, unknown>
    expect(Object.keys(cv).sort()).toEqual([
        'archmm.component1|__connector_entity__:calls|archmm.component2',
        'archmm.component2|__scenario_step__|archmm.component2',
    ])
})

test('Migrate is idempotent: a second run on qualified ids reports no change', () => {
    const model = buildModel()
    const doc = new DiagramDocument()
    const a = new ArchNodeVM(); a.Id = 'component1'; doc.Nodes.Add(a)
    doc.SetNodeVisual('component1', { left: 10, top: 20, w: 100, h: 50 })

    expect(ArchDiagramIdMigration.Migrate(doc, model)).toBe(true)
    expect(ArchDiagramIdMigration.Migrate(doc, model)).toBe(false)
})

test('Migrate leaves freeform (unresolved) node ids untouched', () => {
    const model = buildModel()
    const doc = new DiagramDocument()
    const shape = new ArchNodeVM(); shape.Id = 'n3'; doc.Nodes.Add(shape)

    expect(ArchDiagramIdMigration.Migrate(doc, model)).toBe(false)
    expect(shape.Id).toBe('n3')
})
