import { test, expect, vi } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { DiagramDocument } from '@pragmatic-tech-ai/mural/framework'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBinding } from '../arch-diagram-binding.js'
import { ArchNodeVM } from '../arch-node-vm.js'
import { isConnectorEntity, connectorTypeOf } from '../connector-entity.js'
import type { ConnectorAction } from '../arch-connector-resolver.js'

const MM = `namespace archmm {
  concept location {}
  concept technology {}
  concept actor {}
  concept component {
    relationship in -> location?;
    relationship implemented_by -> technology?;
    relationship depends_on -> component?;
  }
  concept connector {
    relationship from -> actor | component | location;
    relationship to -> actor | component | location;
  }
  taxonomy connectors : represents connector { term calls {} term event {} }
  viewpoint V : frames component, location, actor, technology, connector
}`

function buildModel(): ArchModel {
    const draft = ModelDraft.fromSources(
        [new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))],
        [], { namespace: 'archmm' })
    const model = new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
    vi.spyOn(model, 'save').mockResolvedValue()
    return model
}

function setup(model: ArchModel, srcConcept: string, tgtConcept: string) {
    const src = model.createInViewpoint(srcConcept, 'V')
    const tgt = model.createInViewpoint(tgtConcept, 'V')
    const doc = new DiagramDocument()
    const a = new ArchNodeVM(); a.Id = src.id
    const b = new ArchNodeVM(); b.Id = tgt.id
    doc.Nodes.Add(a); doc.Nodes.Add(b)
    let shown: { actions: readonly ConnectorAction[]; onPick: (a: ConnectorAction) => void } | undefined
    const chooser = { Show: vi.fn((actions: readonly ConnectorAction[], onPick: (a: ConnectorAction) => void) => { shown = { actions, onPick } }) }
    const status = { Text: '' }
    const binding = new ArchDiagramBinding(doc, model, chooser as never, undefined, status)
    binding.attach()
    return { binding, src, tgt, a, b, chooser, status, getShown: () => shown }
}

const connectors = (model: ArchModel) => model.entities().filter((e) => isConnectorEntity(model.repository(), e))

test('drawing between a legal connector pair with no relationship mints a connector entity (default calls)', () => {
    const model = buildModel()
    const { binding, src, tgt, a, b, chooser } = setup(model, 'actor', 'component')
    const addRef = vi.spyOn(model, 'addRef')

    binding.handleConnectorCreated(a, b)

    const cs = connectors(model)
    expect(cs.length).toBe(1)
    expect(cs[0].ref('from')?.id).toBe(src.id)
    expect(cs[0].ref('to')?.id).toBe(tgt.id)
    expect(connectorTypeOf(cs[0])).toBe('calls')
    expect(chooser.Show).not.toHaveBeenCalled()
    expect(model.save).toHaveBeenCalled()
    // No relationship ref was written FROM the source node itself.
    expect(addRef).not.toHaveBeenCalledWith(src.id, expect.anything(), tgt.id)
})

test('a concept relationship still auto-writes its ref (no connector entity)', () => {
    const model = buildModel()
    const { binding, src, tgt, a, b, chooser } = setup(model, 'component', 'technology')
    const addRef = vi.spyOn(model, 'addRef')

    binding.handleConnectorCreated(a, b)

    expect(addRef).toHaveBeenCalledWith(src.id, 'implemented_by', tgt.id)
    expect(connectors(model).length).toBe(0)
    expect(chooser.Show).not.toHaveBeenCalled()
})

test('an illegal pair (no relationship, not a connector pair) sets a status message', () => {
    const model = buildModel()
    // technology has no relationships and is not a legal connector from/to target.
    const { binding, a, b, status, chooser } = setup(model, 'technology', 'technology')

    binding.handleConnectorCreated(a, b)

    expect(connectors(model).length).toBe(0)
    expect(chooser.Show).not.toHaveBeenCalled()
    expect(status.Text).toMatch(/can't connect a technology to a technology/i)
})

test('a pair with BOTH a relationship and a legal connector shows a chooser; picking connect mints the entity', () => {
    const model = buildModel()
    const { binding, src, tgt, a, b, chooser, getShown } = setup(model, 'component', 'component')

    binding.handleConnectorCreated(a, b)

    expect(chooser.Show).toHaveBeenCalledOnce()
    const shown = getShown()!
    // depends_on (relationship) + the connector-entity option.
    expect(shown.actions.some((x) => x.member === 'depends_on')).toBe(true)
    expect(shown.actions.length).toBe(2)
    expect(connectors(model).length).toBe(0)   // deferred until pick

    const connectAction = shown.actions.find((x) => x.member !== 'depends_on')!
    shown.onPick(connectAction)
    const cs = connectors(model)
    expect(cs.length).toBe(1)
    expect(cs[0].ref('from')?.id).toBe(src.id)
    expect(cs[0].ref('to')?.id).toBe(tgt.id)
})
