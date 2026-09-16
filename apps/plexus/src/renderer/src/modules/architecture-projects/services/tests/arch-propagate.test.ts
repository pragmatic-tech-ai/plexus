import { test, expect } from 'vitest'
import { load } from '@pragmatic-tech-ai/todl'
import { propagationFills } from '../arch-propagate.js'

const MM = `namespace m {
  concept category {}
  concept technology { relationship applicableTo -> category; }
  concept component {
    relationship implementedBy -> technology;
    relationship categorisedAs -> category;
  }
  taxonomy Cats : represents category { term ai {} }
  taxonomy Stack : represents technology { term azure { applicableTo = Cats.ai; } }
}`
function repo() { return load([{ uri: 'm.todl', text: MM }]).model }

test('back-fills categorisedAs from the technology term’s own applicableTo ref', () => {
    expect(propagationFills(repo(), 'component', 'Stack.azure', 'implementedBy'))
        .toEqual([{ member: 'categorisedAs', term: 'Cats.ai' }])
})

test('the primary member is never back-filled', () => {
    // Drop the category itself as primary; it carries no refs, so nothing propagates.
    expect(propagationFills(repo(), 'component', 'Cats.ai', 'categorisedAs')).toEqual([])
})

test('a ref matching more than one empty member is skipped (no guess)', () => {
    const AMBIG = `namespace m {
      concept category {}
      concept technology { relationship applicableTo -> category; }
      concept component {
        relationship implementedBy -> technology;
        relationship primaryCat -> category;
        relationship secondaryCat -> category;
      }
      taxonomy Cats : represents category { term ai {} }
      taxonomy Stack : represents technology { term azure { applicableTo = Cats.ai; } }
    }`
    const r = load([{ uri: 'm.todl', text: AMBIG }]).model
    expect(propagationFills(r, 'component', 'Stack.azure', 'implementedBy')).toEqual([])
})
