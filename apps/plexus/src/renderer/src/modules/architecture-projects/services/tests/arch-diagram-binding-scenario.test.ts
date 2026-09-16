import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { DiagramDocument } from '@pragmatic-tech-ai/mural/framework'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBinding } from '../arch-diagram-binding.js'
import { ArchNodeVM } from '../arch-node-vm.js'

// A meta-model with a scenario/sequence/step chain, framed by a Scenarios
// viewpoint. Components are framed by a separate viewpoint so the diagram's
// (Scenarios) scope projects NO structural edges — only the scenario steps.
const MM = `namespace archmm {
  concept component {}
  concept step { relationship src -> component; relationship dst -> component; }
  concept sequence { relationship steps -> step; }
  concept scenario { relationship sequences -> sequence; }
  viewpoint C : frames component
  viewpoint S : frames scenario, sequence, step
}`

function buildModel(): ArchModel {
    const draft = ModelDraft.fromSources(
        [new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))],
        [], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
}

// Model: scenario sc -> sequence sq -> steps a->b, b->c; participants a,b,c.
function buildScenario(model: ArchModel): { sc: string; a: string; b: string; c: string } {
    const a = model.createInViewpoint('component', 'C')
    const b = model.createInViewpoint('component', 'C')
    const c = model.createInViewpoint('component', 'C')
    const st1 = model.createInViewpoint('step', 'S'); model.addRef(st1.id, 'src', a.id); model.addRef(st1.id, 'dst', b.id)
    const st2 = model.createInViewpoint('step', 'S'); model.addRef(st2.id, 'src', b.id); model.addRef(st2.id, 'dst', c.id)
    const sq = model.createInViewpoint('sequence', 'S'); model.addRef(sq.id, 'steps', st1.id); model.addRef(sq.id, 'steps', st2.id)
    const sc = model.createInViewpoint('scenario', 'S'); model.addRef(sc.id, 'sequences', sq.id)
    return { sc: sc.id, a: a.id, b: b.id, c: c.id }
}

test('an active scenario projects its steps as connectors between placed participants', () => {
    const model = buildModel()
    const { sc, a, b, c } = buildScenario(model)

    const doc = new DiagramDocument()
    for (const id of [a, b, c]) { const n = new ArchNodeVM(); n.Id = id; doc.Nodes.Add(n) }

    const binding = new ArchDiagramBinding(doc, model)
    binding.setScope(['S'])          // Scenarios scope: no structural edges project
    binding.attach()
    expect(doc.Connectors.ToArray().length).toBe(0)   // no scenario active yet

    binding.addScenario(sc)
    model.notifyChanged()            // project the scenario's steps
    expect(doc.Connectors.ToArray().length).toBe(2)   // a->b, b->c

    // Connector-authoritative rescan must NOT sweep them (they are projected/ours).
    model.notifyChanged()
    expect(doc.Connectors.ToArray().length).toBe(2)
})

test('a step connector to an unplaced participant is not projected', () => {
    const model = buildModel()
    const { sc, a, b } = buildScenario(model)   // c intentionally not placed

    const doc = new DiagramDocument()
    for (const id of [a, b]) { const n = new ArchNodeVM(); n.Id = id; doc.Nodes.Add(n) }
    const binding = new ArchDiagramBinding(doc, model)
    binding.setScope(['S'])
    binding.attach()
    binding.addScenario(sc)
    model.notifyChanged()

    expect(doc.Connectors.ToArray().length).toBe(1)   // only a->b (b->c dropped: c unplaced)
})
