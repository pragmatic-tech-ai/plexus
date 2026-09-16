import { test, expect, vi } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { Point, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DiagramDocument, ToolboxVisualDescriptor, type ToolboxDropContext } from '@pragmatic-tech-ai/mural/framework'
import { ArchToolboxItem, ArchToolboxVisualKey } from '../../../diagram/services/arch-toolbox-item.js'
import { EntityIconVM } from '../../../diagram/services/entity-icon-vm.js'
import type { TodlPresentationRegistry } from '../../../diagram/services/todl-presentation-registry.js'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'
import { ArchNodeVM } from '../arch-node-vm.js'
import { ArchScenarioDropFactory, ArchScenarioDropFactoryKey } from '../arch-scenario-drop-factory.js'
import { ArchDiagramBindingService } from '../arch-diagram-binding-service.js'
import { containerChildSlot } from '../scenario-flow.js'

// A block is a container with a forward `components` list; a scenario step touches
// the block and a standalone component. Dropping the scenario must bring the
// block's WHOLE membership (c1, c2) onto the canvas, nested, even though neither
// appears in a step.
const MM = `namespace archmm {
  concept location {}
  concept component {
    relationship in -> location?;
    relationship in_block -> block? { annotate containment {} }
  }
  concept block {
    annotate has_children {}
    relationship in -> location;
    components : component[];
  }
  concept step { relationship src -> block; relationship dst -> component; }
  concept sequence { relationship steps -> step; }
  concept scenario { relationship sequences -> sequence; }
  viewpoint C : frames location, component, block
  viewpoint S : frames scenario, sequence, step
}`

function buildModel(): ArchModel {
    const draft = ModelDraft.fromSources(
        [new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))],
        [], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
}

function makeContext(doc: DiagramDocument, scenarioId: string): ToolboxDropContext {
    const descriptor = new ToolboxVisualDescriptor(ArchToolboxVisualKey, 'scenario')
    const reg = { iconKeyFor: () => undefined } as unknown as TodlPresentationRegistry
    const item = new ArchToolboxItem('scenario:' + scenarioId, 'Scn', descriptor, ArchScenarioDropFactoryKey, new EntityIconVM(reg, 'scenario'))
    return { Item: item, Descriptor: descriptor, Position: new Point(100, 50), Diagram: undefined as never, Mutator: doc }
}

function providerFor(model: ArchModel): IServiceProvider {
    const bindingSvc = { modelForDocument: () => model, addScenario: vi.fn(() => Promise.resolve()) }
    return { get: (k: unknown) => (k === ArchDiagramBindingService.Key ? bindingSvc : undefined) } as unknown as IServiceProvider
}

test('dropping a scenario materializes a participant block`s full membership, nested inside it', () => {
    const model = buildModel()
    const chat = model.createInViewpoint('block', 'C')
    const c1 = model.createInViewpoint('component', 'C')
    const c2 = model.createInViewpoint('component', 'C')
    model.addRef(chat.id, 'components', c1.id)
    model.addRef(chat.id, 'components', c2.id)
    const standalone = model.createInViewpoint('component', 'C')
    const st = model.createInViewpoint('step', 'S'); model.addRef(st.id, 'src', chat.id); model.addRef(st.id, 'dst', standalone.id)
    const sq = model.createInViewpoint('sequence', 'S'); model.addRef(sq.id, 'steps', st.id)
    const sc = model.createInViewpoint('scenario', 'S'); model.addRef(sc.id, 'sequences', sq.id)

    const doc = new DiagramDocument()
    new ArchScenarioDropFactory(providerFor(model)).CreateDropped(makeContext(doc, sc.id))

    // Participants (chat, standalone) AND the block's non-participant members (c1, c2).
    const ids = doc.Nodes.ToArray().filter((n): n is ArchNodeVM => n instanceof ArchNodeVM).map((n) => n.Id).sort()
    expect(ids).toEqual([chat.id, c1.id, c2.id, standalone.id].sort())

    // c1/c2 sit in the block's in-container grid (positions relative to the block).
    const chatPos = doc.GetNodeVisual(chat.id)!
    const base = { left: chatPos.left, top: chatPos.top }
    expect(doc.GetNodeVisual(c1.id)).toMatchObject(containerChildSlot(base, 0))
    expect(doc.GetNodeVisual(c2.id)).toMatchObject(containerChildSlot(base, 1))
})

test('a member already on the canvas is reused, not duplicated or repositioned', () => {
    const model = buildModel()
    const chat = model.createInViewpoint('block', 'C')
    const c1 = model.createInViewpoint('component', 'C')
    model.addRef(chat.id, 'components', c1.id)
    const standalone = model.createInViewpoint('component', 'C')
    const st = model.createInViewpoint('step', 'S'); model.addRef(st.id, 'src', chat.id); model.addRef(st.id, 'dst', standalone.id)
    const sq = model.createInViewpoint('sequence', 'S'); model.addRef(sq.id, 'steps', st.id)
    const sc = model.createInViewpoint('scenario', 'S'); model.addRef(sc.id, 'sequences', sq.id)

    const doc = new DiagramDocument()
    const pre = new ArchNodeVM(); pre.Id = c1.id
    doc.AddNode(pre)
    doc.SetNodeVisual(c1.id, { left: 777, top: 777, w: 72, h: 56 })

    new ArchScenarioDropFactory(providerFor(model)).CreateDropped(makeContext(doc, sc.id))

    const c1Nodes = doc.Nodes.ToArray().filter((n): n is ArchNodeVM => n instanceof ArchNodeVM && n.Id === c1.id)
    expect(c1Nodes.length).toBe(1)                     // reused, not duplicated
    expect(doc.GetNodeVisual(c1.id)?.left).toBe(777)   // kept its place
})
