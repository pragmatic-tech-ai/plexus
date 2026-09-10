import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { DiagramDocument } from '@pragmatic-tech-ai/mural/framework'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBinding } from '../arch-diagram-binding.js'

const MM = `namespace archmm {
  concept component {}
  viewpoint ComponentView : frames component
  viewpoint DeploymentView : frames component
}`
function model(): ArchModel {
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))], [], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
}

test('scopeSet defaults to all viewpoints when unset', () => {
    const b = new ArchDiagramBinding(new DiagramDocument(), model())
    expect([...b.scopeSet()].sort()).toEqual(['ComponentView', 'DeploymentView'])
})

test('setScope narrows the scope', () => {
    const b = new ArchDiagramBinding(new DiagramDocument(), model())
    b.setScope(['ComponentView'])
    expect([...b.scopeSet()]).toEqual(['ComponentView'])
})
