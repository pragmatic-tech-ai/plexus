import { test, expect } from 'vitest'
import { load } from '@pragmatic-tech-ai/todl'
import { resolveDropActions, DropActionKind } from '../arch-drop-resolver.js'

const MM = `namespace archmm {
  concept technology {}
  concept component { relationship realisedBy -> technology; }
  concept node { relationship hosts -> component; }
  concept lonely {}
  concept actor {}
  concept edge { relationship end -> actor | component; }
  viewpoint ComponentView : frames component
  viewpoint DeploymentView : frames node, component
  viewpoint EdgeView : frames edge
  taxonomy Stack : represents technology { term azure {} }
  taxonomy Kinds : represents component { term webKind {} }
  taxonomy Solo : represents lonely { term hermit {} }
}`

function repo() { return load([{ uri: 'mm.todl', text: MM }]).model }
const scope = new Set(['ComponentView', 'DeploymentView'])

// Toolbox term ids are qualified by their taxonomy (e.g. `Stack.azure`), and a
// term's typeOf is the concept its taxonomy represents.
test('a library term (type technology) yields the single reference candidate that targets it', () => {
    const actions = resolveDropActions(repo(), 'Stack.azure', scope)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ kind: DropActionKind.Reference, concept: 'component', member: 'realisedBy', term: 'Stack.azure' })
})

test('a class-term whose type is a framed concept yields ONLY reference candidates (no bare Instance)', () => {
    // webKind is a class (`class = true`); a bare `component` instance would lose which
    // kind it is, so the Instance action is suppressed — only the reference survives.
    const actions = resolveDropActions(repo(), 'mm:Kinds.webKind', scope)   // 'mm:' prefix stripped
    const kinds = actions.map((a) => `${a.kind}:${a.concept}${a.member ? '.' + a.member : ''}`)
    expect(kinds).not.toContain('instance:component')
    expect(kinds).toContain('reference:node.hosts')   // node.hosts targets component
    expect(actions.length).toBe(1)
})

test('a union relationship matches a term whose type is a non-first union member', () => {
    // `end -> actor | component`; webKind is a `component` (the 2nd union member).
    // Single-target routing would only check the first target (actor) and miss it.
    const actions = resolveDropActions(repo(), 'Kinds.webKind', new Set(['EdgeView']))
    const kinds = actions.map((a) => `${a.kind}:${a.concept}${a.member ? '.' + a.member : ''}`)
    expect(kinds).toContain('reference:edge.end')
})

test('a term framed by nothing and unreferenced yields no candidates (reject)', () => {
    // hermit is type `lonely`; lonely is framed by no viewpoint and no framed
    // concept has a member targeting lonely → 0 actions.
    expect(resolveDropActions(repo(), 'Solo.hermit', scope)).toEqual([])
})

// A container-concept term (e.g. a library location) is PLACED as a container,
// not referenced from a materialize root. `location` is a container concept
// (target of component.in); dropping the `azure` location term places it.
const CONTAIN_MM = `namespace archmm {
  annotation materialize { concept : identifier?; via : identifier?; propagate : boolean?; }
  concept location {}
  concept component { annotate materialize {} relationship in -> location; }
  viewpoint V : frames component, location
  viewpoint Flow : frames component
  taxonomy Regions : represents location { term azure {} }
}`
test('dropping a container-concept term (location) yields a single Place action, not a component reference', () => {
    const r = load([{ uri: 'mm.todl', text: CONTAIN_MM }]).model
    const actions = resolveDropActions(r, 'Regions.azure', new Set(['V']))
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ kind: DropActionKind.Place, concept: 'location', term: 'Regions.azure' })
})

test('dropping a container-concept term where its concept is NOT framed is REJECTED (no silent component)', () => {
    // scope Flow frames component but NOT location. Placing azure is illegal here,
    // and the facet-drop fallback would mint a component `in` azure — the surprise.
    // The resolver returns a Rejected action so the factory can interrupt + explain.
    const r = load([{ uri: 'mm.todl', text: CONTAIN_MM }]).model
    const actions = resolveDropActions(r, 'Regions.azure', new Set(['Flow']))
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ kind: DropActionKind.Rejected, concept: 'location', term: 'Regions.azure' })
})
