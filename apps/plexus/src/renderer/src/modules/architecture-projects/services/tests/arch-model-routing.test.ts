import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft, checkAgainst, Severity } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'

// `component` has no required members, so a bare instance validates.
const MM = `namespace archmm {
  concept component {}
  viewpoint ComponentView : frames component
}`

function mmDoc() { return toJSON(load([{ uri: 'mm.todl', text: MM }]).model) }

function emptyModel(): ArchModel {
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(mmDoc()))], [], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
}

test('createInViewpoint homes the entity in the viewpoint file, stamps conforms, and round-trips', () => {
    const m = emptyModel()
    const e = m.createInViewpoint('component', 'ComponentView')
    expect(e.concept).toBe('component')
    expect(m.homeOf(e.id)).toBe('componentview.todl')
    const files = new Map(m['draft'].toTodlByFile())   // access via bracket for the test
    const text = files.get('componentview.todl')!
    expect(text).toContain('conforms ComponentView')
    expect(text).toContain(e.id)
    // Round-trips clean against the meta-model base.
    const diags = checkAgainst([mmDoc()], [{ uri: 'componentview.todl', text }]).diagnostics
    expect(diags.filter((d) => d.severity === Severity.Error)).toEqual([])
})

test('uniqueId disambiguates a taken id; a second createInViewpoint reuses the same file', () => {
    const m = emptyModel()
    const a = m.createInViewpoint('component', 'ComponentView')
    const b = m.createInViewpoint('component', 'ComponentView')
    expect(a.id).toBe('component1')
    expect(b.id).toBe('component2')
    expect(m.homeForViewpoint('ComponentView')).toBe('componentview.todl')   // reuses a's file
})
