import { test, expect } from 'vitest'
import { load } from '@pragmatic-tech-ai/todl'
import { materializeOf, isMaterializeRoot, materializeRoots } from '../arch-materialize.js'

const MM = `namespace m {
  annotation materialize { concept : identifier?; via : identifier?; propagate : boolean?; }
  concept technology {}
  concept category {}
  concept application {}
  concept component {
    annotate materialize {}
    relationship implementedBy -> technology;
    relationship categorisedAs -> category;
  }
  taxonomy Cats : represents category {
    term ai {}
    term special { annotate materialize { concept = application; } }
  }
}`
function repo() { return load([{ uri: 'm.todl', text: MM }]).model }

test('materializeOf returns {} for a bare marker and undefined when absent', () => {
    expect(materializeOf(repo(), 'component')).toEqual({})
    expect(materializeOf(repo(), 'technology')).toBeUndefined()
})

test('materializeOf reads a redirect override on a term', () => {
    expect(materializeOf(repo(), 'Cats.special')).toEqual({ concept: 'application' })
})

test('isMaterializeRoot is true for a bare-marked concept, false for a redirect', () => {
    expect(isMaterializeRoot(repo(), 'component')).toBe(true)
    expect(isMaterializeRoot(repo(), 'Cats.special')).toBe(false)
    expect(isMaterializeRoot(repo(), 'technology')).toBe(false)
})

test('materializeRoots lists only the root concepts', () => {
    expect(materializeRoots(repo())).toEqual(['component'])
})
