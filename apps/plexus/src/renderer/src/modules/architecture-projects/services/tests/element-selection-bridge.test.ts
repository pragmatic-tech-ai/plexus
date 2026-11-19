import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { BoardDocument } from '@pragmatic-tech-ai/mural/framework'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'
import { ArchNodeVM } from '../arch-node-vm.js'
import { selectionToElements } from '../element-selection-bridge.js'
import type { ArchBoardBindingService } from '../arch-board-binding-service.js'
import type { TodlPresentationRegistry } from '../../../board/services/todl-presentation-registry.js'

const MM = `namespace t { concept component {} viewpoint V : frames component }`
const MODEL = `namespace t { model M : t conforms V { component web {} } }`

function buildModel(): ArchModel
{
  const base = new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))
  const draft = ModelDraft.fromSources([base], [{ uri: 'a.todl', text: MODEL }], { namespace: 't' })
  return new ArchModel(draft, new FakeStorage('fake://A'), 't')
}

// Structural fakes: the bridge needs only these members.
function fakes(model: ArchModel, selected: unknown[])
{
  const bindingSvc = { modelForDocument: () => model } as unknown as ArchBoardBindingService
  const registry = { iconKeyFor: () => undefined } as unknown as TodlPresentationRegistry
  const doc = { ActiveView: { SelectedItems: selected } } as unknown as BoardDocument
  return { bindingSvc, registry, doc }
}

test('maps selected node VMs to Elements of the bound model', () => {
  const model = buildModel()
  const node = new ArchNodeVM(); node.Id = 't.web'
  const { bindingSvc, registry, doc } = fakes(model, [node])
  const els = selectionToElements(doc, bindingSvc, registry)
  expect(els).toHaveLength(1)
  expect(els[0].id).toBe('t.web')
  expect(els[0].concept).toBe('t.component')
})

test('an unbound document yields no elements', () => {
  const bindingSvc = { modelForDocument: () => undefined } as unknown as ArchBoardBindingService
  const registry = { iconKeyFor: () => undefined } as unknown as TodlPresentationRegistry
  const node = new ArchNodeVM(); node.Id = 't.web'
  const doc = { ActiveView: { SelectedItems: [node] } } as unknown as BoardDocument
  expect(selectionToElements(doc, bindingSvc, registry)).toEqual([])
})

test('an empty selection yields no elements', () => {
  const model = buildModel()
  const { bindingSvc, registry, doc } = fakes(model, [])
  expect(selectionToElements(doc, bindingSvc, registry)).toEqual([])
})
