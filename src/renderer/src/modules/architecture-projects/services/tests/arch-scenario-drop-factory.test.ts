import { test, expect, vi } from 'vitest'
import { Point, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DiagramDocument, ToolboxVisualDescriptor, type ToolboxDropContext } from '@pragmatic-tech-ai/mural/framework'
import { TodlVisualResolverKey } from '../../../diagram/services/todl-visual-resolver.js'
import { ArchToolboxItem } from '../../../diagram/services/arch-toolbox-item.js'
import { EntityIconVM } from '../../../diagram/services/entity-icon-vm.js'
import type { TodlPresentationRegistry } from '../../../diagram/services/todl-presentation-registry.js'
import { ArchDiagramBindingService } from '../arch-diagram-binding-service.js'
import { ArchNodeVM } from '../arch-node-vm.js'
import { ArchScenarioDropFactory, ArchScenarioDropFactoryKey, scenarioIdOf } from '../arch-scenario-drop-factory.js'
import type { FlowEntity } from '../scenario-flow.js'

// Fake entities: a scenario 'sc' with one sequence a->b->c.
function ent(id: string, rels: Record<string, FlowEntity[]> = {}): FlowEntity {
  return { id, refs: (m) => rels[m] ?? [] }
}
function step(s: FlowEntity, d: FlowEntity): FlowEntity { return ent('step', { src: [s], dst: [d] }) }
const a = ent('a'), b = ent('b'), c = ent('c')
const scenario = ent('sc', { sequences: [ent('s', { steps: [step(a, b), step(b, c)] })] })

function makeContext(doc: DiagramDocument, scenarioId: string): ToolboxDropContext {
  const descriptor = new ToolboxVisualDescriptor(TodlVisualResolverKey, 'scenario')
  const reg = { iconKeyFor: () => undefined } as unknown as TodlPresentationRegistry
  const item = new ArchToolboxItem('scenario:' + scenarioId, 'Scn', descriptor, ArchScenarioDropFactoryKey, new EntityIconVM(reg, 'scenario'))
  return { Item: item, Descriptor: descriptor, Position: new Point(100, 50), Diagram: undefined as never, Mutator: doc }
}

function stubProvider() {
  const model = { entities: () => [scenario], create: vi.fn(), addRef: vi.fn(), save: vi.fn() }
  const bindingSvc = { modelForDocument: () => model, addScenario: vi.fn(() => Promise.resolve()) }
  const provider = { get: (k: unknown) => (k === ArchDiagramBindingService.Key ? bindingSvc : undefined) } as unknown as IServiceProvider
  return { provider, model, bindingSvc }
}

test('scenarioIdOf strips the scenario: prefix', () => {
  expect(scenarioIdOf('scenario:sc')).toBe('sc')
  expect(scenarioIdOf('instance:x')).toBeUndefined()
})

test('dropping a scenario adds a node per participant and registers the scenario, no model writes', () => {
  const doc = new DiagramDocument()
  const { provider, model, bindingSvc } = stubProvider()
  const factory = new ArchScenarioDropFactory(provider)

  factory.CreateDropped(makeContext(doc, 'sc'))

  const nodes = doc.Nodes.ToArray().filter((n): n is ArchNodeVM => n instanceof ArchNodeVM)
  expect(nodes.map((n) => n.Id).sort()).toEqual(['a', 'b', 'c'])
  // Geometry rides the document store by id (the container Figure owns it).
  expect(doc.GetNodeVisual('a')?.left).toBe(100)   // origin col 0
  expect(doc.GetNodeVisual('b')?.left).toBe(300)   // col 1
  // The binding projects the step connectors; the factory just registers the scenario.
  expect(bindingSvc.addScenario).toHaveBeenCalledWith(doc, 'sc')
  expect(model.addRef).not.toHaveBeenCalled()
  expect(model.create).not.toHaveBeenCalled()
  expect(model.save).not.toHaveBeenCalled()
})

// A model rich enough for the containment reader: components c1/c2 both nest in
// location 'azure' (marked @has_children), a scenario c1->c2. The fake repo answers
// only what containmentParentOf / isContainerConcept touch here.
function containedProvider() {
  const azure = { id: 'azure', concept: 'location', schema: () => ({ relationships: [] }), refs: () => [], referrers: () => [] }
  const comp = (id: string): FlowEntity & { concept: string; schema: () => { relationships: Array<{ name: string; targets: string[] }> }; referrers: () => FlowEntity[] } => ({
    id,
    concept: 'component',
    schema: () => ({ relationships: [{ name: 'in', targets: ['location'] }] }),
    refs: (m) => (m === 'in' ? [azure] : []),
    referrers: () => [],
  })
  const c1 = comp('c1'), c2 = comp('c2')
  const stepE = (s: FlowEntity, d: FlowEntity): FlowEntity => ({ id: 'step', refs: (m) => (m === 'src' ? [s] : m === 'dst' ? [d] : []) })
  const scenario: FlowEntity = { id: 'sc', refs: (m) => (m === 'sequences' ? [{ id: 'seq', refs: (mm) => (mm === 'steps' ? [stepE(c1, c2)] : []) }] : []) }
  const repo = { resolve: (p: string) => (p === 'location@has_children' ? {} : undefined), allNodes: () => [] }
  const model = { entities: () => [scenario, c1, c2, azure], repository: () => repo, create: vi.fn(), addRef: vi.fn(), save: vi.fn() }
  const bindingSvc = { modelForDocument: () => model, addScenario: vi.fn(() => Promise.resolve()) }
  const provider = { get: (k: unknown) => (k === ArchDiagramBindingService.Key ? bindingSvc : undefined) } as unknown as IServiceProvider
  return { provider, bindingSvc }
}

test('places components inside an existing location container instead of the free flow', () => {
  const doc = new DiagramDocument()
  const az = new ArchNodeVM(); az.Id = 'azure'
  doc.AddNode(az)
  doc.SetNodeVisual('azure', { left: 1000, top: 500, w: 200, h: 160 })   // placed container
  const { provider, bindingSvc } = containedProvider()

  new ArchScenarioDropFactory(provider).CreateDropped(makeContext(doc, 'sc'))

  // c1/c2 land INSIDE azure: origin (1000,500) + inset (8,32), then a grid column
  // step (96) for the second — not on the free flow at the drop point (100,50).
  expect(doc.GetNodeVisual('c1')).toMatchObject({ left: 1008, top: 532 })
  expect(doc.GetNodeVisual('c2')).toMatchObject({ left: 1104, top: 532 })
  expect(bindingSvc.addScenario).toHaveBeenCalledWith(doc, 'sc')
})

test('re-uses an already-present node instead of duplicating it', () => {
  const doc = new DiagramDocument()
  const pre = new ArchNodeVM(); pre.Id = 'b'
  doc.AddNode(pre)
  doc.SetNodeVisual('b', { left: 999, top: 999, w: 72, h: 56 })   // pre-placed position
  const { provider, bindingSvc } = stubProvider()
  new ArchScenarioDropFactory(provider).CreateDropped(makeContext(doc, 'sc'))

  const bNodes = doc.Nodes.ToArray().filter((n): n is ArchNodeVM => n instanceof ArchNodeVM && n.Id === 'b')
  expect(bNodes.length).toBe(1)                    // not duplicated
  expect(doc.GetNodeVisual('b')?.left).toBe(999)   // reused node not moved
  expect(bindingSvc.addScenario).toHaveBeenCalledWith(doc, 'sc')
})
