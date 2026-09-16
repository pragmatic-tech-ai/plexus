import { test, expect } from 'vitest'
import { load } from '@pragmatic-tech-ai/todl'
import { resolveConnectorActions } from '../arch-connector-resolver.js'

const MM = `namespace archmm {
  concept technology {}
  concept database : technology {}
  concept component {
    relationship realisedBy -> technology;
    relationship calls -> component;
    relationship uses -> component;
  }
  viewpoint V : frames component, technology, database
}`

function repo() { return load([{ uri: 'mm.todl', text: MM }]).model }
const scope = new Set(['V'])

test('one matching relationship member → one action', () => {
    const actions = resolveConnectorActions(repo(), 'component', 'technology', scope)
    expect(actions.map((a) => a.member)).toEqual(['realisedBy'])
})

test('subtype target is accepted via the supertype member (subtype-aware)', () => {
    // realisedBy targets technology; database is a subtype → still matches.
    const actions = resolveConnectorActions(repo(), 'component', 'database', scope)
    expect(actions.map((a) => a.member)).toEqual(['realisedBy'])
})

test('several matching members → many actions (chooser case)', () => {
    const actions = resolveConnectorActions(repo(), 'component', 'component', scope)
    expect(actions.map((a) => a.member).sort()).toEqual(['calls', 'uses'])
})

test('no member accepting the target → empty (reject)', () => {
    const actions = resolveConnectorActions(repo(), 'technology', 'component', scope)
    expect(actions).toEqual([])
})

test('source concept out of scope → empty', () => {
    const actions = resolveConnectorActions(repo(), 'component', 'technology', new Set(['OTHER']))
    expect(actions).toEqual([])
})
