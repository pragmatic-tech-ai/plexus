import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'

const MM = `namespace m {
  concept service { label : string; }
  viewpoint V : frames service
}`

function build(): ArchModel {
    const base = new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))
    const draft = ModelDraft.fromSources([base], [], { namespace: 'm' })
    return new ArchModel(draft, new FakeStorage('fake://arch'), 'm', base)
}

test('capture then restore round-trips own entities', () => {
    const model = build()
    const e = model.createInViewpoint('service', 'V')
    model.setField(e.id, 'label', 'First')
    const snapshot = model.toTodlByFile()

    model.setField(e.id, 'label', 'Changed')
    expect(model.repository().resolve(e.id)?.attrs.get('label')).toBe('Changed')

    model.restore(snapshot)
    expect(model.repository().resolve(e.id)?.attrs.get('label')).toBe('First')
})
