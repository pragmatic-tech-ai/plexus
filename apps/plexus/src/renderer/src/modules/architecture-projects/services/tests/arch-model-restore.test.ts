import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'

const MM = `namespace m {
  concept service { label : string; }
  viewpoint V : frames service
}`

function build(): ArchModel
{
    const base = new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))
    const draft = ModelDraft.fromSources([base], [], { namespace: 'm' })
    return new ArchModel(draft, new FakeStorage('fake://arch'), 'm', base)
}

test('capture then restore round-trips own entities', () => {
    const model = build()
    const e = model.createInViewpoint('m.service', 'm.V')
    model.setField(e.id, 'label', 'First')
    const snapshot = model.toTodlByFile()

    model.setField(e.id, 'label', 'Changed')
    expect(model.repository().resolve(e.id)?.attrs.get('label')).toBe('Changed')

    model.restore(snapshot)
    expect(model.repository().resolve(e.id)?.attrs.get('label')).toBe('First')
})

// Project namespace (`myproj`) DIFFERS from the meta-model namespace
// (`tech_architecture`): a minted id must carry the PROJECT namespace and a bare
// local name, so it survives a save -> reload and the diagram node re-binds.
test('a minted instance id is project-namespaced + bare-based and survives save/reload', async () => {
    const TECH = `namespace tech_architecture {
  concept component { label : string; }
  viewpoint V : frames component
}`
    const baseRepo = new Repository(graphFromJSON(toJSON(load([{ uri: 'tech.todl', text: TECH }]).model)))
    const storage = new FakeStorage('fake://myproj')
    const draft = ModelDraft.fromSources([baseRepo], [], { namespace: 'myproj' })
    const model = new ArchModel(draft, storage, 'myproj', baseRepo)

    const e = model.createInViewpoint('tech_architecture.component', 'tech_architecture.V')
    expect(e.id).toBe('myproj.component1')
    expect(e.concept).toBe('tech_architecture.component')

    await model.save()
    const sources: { uri: string; text: string }[] = []
    for (const [uri] of model.toTodlByFile()) sources.push({ uri, text: await storage.ReadText(uri) })
    model.reloadFromDisk(sources)

    const reloaded = model.entities().find((x) => x.id === 'myproj.component1')
    expect(reloaded).toBeDefined()
    expect(model.entities().map((x) => x.id)).toEqual(['myproj.component1'])
})
