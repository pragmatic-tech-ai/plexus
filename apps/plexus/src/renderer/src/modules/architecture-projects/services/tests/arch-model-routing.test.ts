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

function emptyModel(): ArchModel
{
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(mmDoc()))], [], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
}

test('createInViewpoint homes the entity in the viewpoint file, stamps conforms, and round-trips', () => {
    const m = emptyModel()
    const e = m.createInViewpoint('archmm.component', 'archmm.ComponentView')
    expect(e.concept).toBe('archmm.component')
    expect(m.homeOf(e.id)).toBe('componentview.todl')
    const files = new Map(m['draft'].toTodlByFile())   // access via bracket for the test
    const text = files.get('componentview.todl')!
    expect(text).toContain('conforms archmm.ComponentView')
    expect(e.id).toBe('archmm.component1')
    expect(text).toContain('component1')   // emitted as the local name; the loader re-qualifies it
    // Round-trips clean against the meta-model base.
    const diags = checkAgainst([mmDoc()], [{ uri: 'componentview.todl', text }]).diagnostics
    expect(diags.filter((d) => d.severity === Severity.Error)).toEqual([])
})

test('uniqueId disambiguates a taken id; a second createInViewpoint reuses the same file', () => {
    const m = emptyModel()
    const a = m.createInViewpoint('archmm.component', 'archmm.ComponentView')
    const b = m.createInViewpoint('archmm.component', 'archmm.ComponentView')
    expect(a.id).toBe('archmm.component1')
    expect(b.id).toBe('archmm.component2')
    expect(m.homeForViewpoint('archmm.ComponentView')).toBe('componentview.todl')   // reuses a's file
})
