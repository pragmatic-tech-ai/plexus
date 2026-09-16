import { test, expect } from 'vitest'
import { load } from '@pragmatic-tech-ai/todl'
import { resolveDropActions, DropActionKind } from '../arch-drop-resolver.js'

const MM = `namespace m {
  annotation materialize { concept : identifier?; via : identifier?; propagate : boolean?; }
  concept technology {}
  concept category {}
  concept component {
    annotate materialize {}
    relationship implementedBy -> technology;
    relationship categorisedAs -> category;
  }
  concept other { relationship uses -> technology; }
  viewpoint V : frames component, other
  taxonomy Stack : represents technology { term azure {} }
  taxonomy Cats : represents category { term ai {} }
}`
function repo() { return load([{ uri: 'm.todl', text: MM }]).model }
const scope = new Set(['V'])

test('dropping a technology yields exactly one action — the root component member', () => {
    const actions = resolveDropActions(repo(), 'Stack.azure', scope)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ kind: DropActionKind.Reference, concept: 'component', member: 'implementedBy', term: 'Stack.azure' })
})

test('the non-root concept `other` that also accepts technology is NOT scanned (no ambiguity, no chooser)', () => {
    const actions = resolveDropActions(repo(), 'Stack.azure', scope)
    expect(actions.map((a) => a.concept)).not.toContain('other')
})

test('dropping a category yields the root component category member', () => {
    const actions = resolveDropActions(repo(), 'Cats.ai', scope)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ kind: DropActionKind.Reference, concept: 'component', member: 'categorisedAs' })
})

test('a term accepted by no root yields no actions (reject)', () => {
    const NOROOT = `namespace m {
      annotation materialize { concept : identifier?; via : identifier?; propagate : boolean?; }
      concept a {} concept b { annotate materialize {} relationship r -> a; }
      concept c {}
      viewpoint V : frames b
      taxonomy T : represents c { term t {} }
    }`
    const r = load([{ uri: 'm.todl', text: NOROOT }]).model
    expect(resolveDropActions(r, 'T.t', new Set(['V']))).toEqual([])
})

// A materialize-root concept that is a non-container LEAF (an `actor`): dropping
// one of its taxonomy archetypes places the archetype itself as a node, rather
// than instantiating a bare instance (class-terms are excluded from that) or
// referencing it from another root (nothing does).
const LEAF = `namespace m {
  annotation materialize { concept : identifier?; via : identifier?; propagate : boolean?; }
  concept technology {}
  concept component { annotate materialize {} relationship implementedBy -> technology; }
  concept actor { annotate materialize {} }
  viewpoint V : frames component, actor
  taxonomy Stack : represents technology { term azure {} }
  taxonomy Actors : represents actor { term internal {} }
}`
function leafRepo() { return load([{ uri: 'm.todl', text: LEAF }]).model }

test('dropping an actor archetype places the archetype as a leaf node', () => {
    const actions = resolveDropActions(leafRepo(), 'Actors.internal', new Set(['V']))
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ kind: DropActionKind.Place, concept: 'actor', term: 'Actors.internal' })
})

test('place-leaf is gated on the concept being a root — a non-root taxonomy archetype still references, never places', () => {
    // `technology` is NOT a materialize root here, so its archetype resolves to the
    // component reference member, not a Place (guards against over-placing).
    const actions = resolveDropActions(leafRepo(), 'Stack.azure', new Set(['V']))
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ kind: DropActionKind.Reference, concept: 'component', member: 'implementedBy' })
})

test('an actor archetype dropped on a diagram that does not frame actor does not place', () => {
    // scope excludes actor's framing viewpoint → no place action (falls through).
    const actions = resolveDropActions(leafRepo(), 'Actors.internal', new Set(['other']))
    expect(actions.some((a) => a.kind === DropActionKind.Place)).toBe(false)
})
