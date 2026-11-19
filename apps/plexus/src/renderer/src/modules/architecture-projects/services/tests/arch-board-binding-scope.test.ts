import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { BoardDocument } from '@pragmatic-tech-ai/mural/framework'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'
import { ArchBoardBinding } from '../arch-board-binding.js'

const MM = `namespace archmm {
  concept component {}
  viewpoint ComponentView : frames component
  viewpoint DeploymentView : frames component
}`
function model(): ArchModel
{
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))], [], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
}

test('scopeSet defaults to all viewpoints when unset', () => {
    const b = new ArchBoardBinding(new BoardDocument(), model())
    expect([...b.scopeSet()].sort()).toEqual(['archmm.ComponentView', 'archmm.DeploymentView'])
})

test('setScope narrows the scope', () => {
    const b = new ArchBoardBinding(new BoardDocument(), model())
    b.setScope(['archmm.ComponentView'])
    expect([...b.scopeSet()]).toEqual(['archmm.ComponentView'])
})
