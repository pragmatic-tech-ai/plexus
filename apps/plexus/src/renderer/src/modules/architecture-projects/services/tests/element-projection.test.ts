import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft, type Entity } from '@pragmatic-tech-ai/todl'
import { ElementProjection } from '../element-projection.js'

// Ported from TODL's retired compiler-services/model/tests/element.test.ts (2f9976a)
// so the Plexus-owned projection keeps the exact semantics it replaced.
const MM = `namespace t {
  concept category {}
  concept technology { relationship partOf -> technology; }
  concept component {
    name : string;
    relationship hostedIn -> technology;
    relationship categorisedAs -> category;
    relationship implementedBy -> technology;
    relationship linkedTo -> component;
  }
  taxonomy Cats : represents category { term ai {} }
  taxonomy Stack : represents technology { term cloud {}  term azure { partOf = Stack.cloud; } }
  viewpoint V : frames component
}`

const MODEL = `namespace t {
  model M : t conforms V {
    component c1 { name = "C One"; hostedIn = Stack.cloud; categorisedAs = Cats.ai; implementedBy = Stack.azure; }
    component c2 { name = "C Two"; }
  }
}`

function setup(): { repo: Repository; entity: (id: string) => Entity }
{
  const base = new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))
  const draft = ModelDraft.fromSources([base], [{ uri: 'a.todl', text: MODEL }], { namespace: 't' })
  draft.addRef('t.c1', 'linkedTo', 't.c2')
  draft.addRef('t.c2', 'linkedTo', 't.c1')
  draft.setField('t.c1', 'conforms', 't.V')
  const entity = (id: string): Entity => draft.ownInstances().find((e) => e.id === id)!
  return { repo: draft.model, entity }
}

test('core: id/concept/fields and resolved refs', () => {
  const { repo, entity } = setup()
  const el = new ElementProjection(repo).Project(entity('t.c1'))
  expect(el.id).toBe('t.c1')
  expect(el.concept).toBe('t.component')
  expect(el.fields.name).toBe('C One')
  expect(el.refs.categorisedAs![0]!.id).toBe('t.Cats.ai')
  expect(el.refs.categorisedAs![0]!.concept).toBe('t.category')
})

test('empty relationship members are omitted from refs', () => {
  const { repo, entity } = setup()
  const c2 = new ElementProjection(repo).Project(entity('t.c1')).refs.linkedTo![0]!
  expect(c2.id).toBe('t.c2')
  expect(c2.refs.categorisedAs).toBeUndefined()
})

test('deep nesting resolves aggregates inline', () => {
  const { repo, entity } = setup()
  const azure = new ElementProjection(repo).Project(entity('t.c1')).refs.implementedBy![0]!
  expect(azure.id).toBe('t.Stack.azure')
  expect(azure.refs.partOf![0]!.id).toBe('t.Stack.cloud')
})

test('cycle guard: a back-reference is truncated with empty refs', () => {
  const { repo, entity } = setup()
  const back = new ElementProjection(repo).Project(entity('t.c1')).refs.linkedTo![0]!.refs.linkedTo![0]!
  expect(back.id).toBe('t.c1')
  expect(back.truncated).toBe(true)
  expect(Object.keys(back.refs)).toHaveLength(0)
})

test('maxDepth cuts recursion without marking truncated', () => {
  const { repo, entity } = setup()
  const azure = new ElementProjection(repo, { maxDepth: 1 }).Project(entity('t.c1')).refs.implementedBy![0]!
  expect(Object.keys(azure.refs)).toHaveLength(0)
  expect(azure.truncated).toBeUndefined()
})

test('schema facet mirrors the concept\'s declared members', () => {
  const { repo, entity } = setup()
  const el = new ElementProjection(repo).Project(entity('t.c1'))
  expect(el.schema.concept).toBe('t.component')
  expect(el.schema.fields.some((f) => f.name === 'name')).toBe(true)
  const cat = el.schema.relationships.find((r) => r.name === 'categorisedAs')
  expect(cat?.targets).toContain('t.category')
})

test('provenance: conforms from attrs, home from injected homeOf', () => {
  const { repo, entity } = setup()
  const el = new ElementProjection(repo, { homeOf: (id) => (id === 't.c1' ? 'application.todl' : undefined) }).Project(entity('t.c1'))
  expect(el.provenance.conforms).toBe('t.V')
  expect(el.provenance.home).toBe('application.todl')
})

test('referredBy is present on the root and absent on nested nodes', () => {
  const { repo, entity } = setup()
  const el = new ElementProjection(repo).Project(entity('t.c1'))
  expect(el.referredBy!.some((r) => r.id === 't.c2' && r.via === 'linkedTo')).toBe(true)
  expect(el.refs.implementedBy![0]!.referredBy).toBeUndefined()
})

test('presentation: default label, and injected resolver wins', () => {
  const { repo, entity } = setup()
  const plain = new ElementProjection(repo).Project(entity('t.c1'))
  expect(plain.presentation.label).toBe('C One')
  expect(plain.presentation.iconKey).toBeUndefined()

  const injected = new ElementProjection(repo, {
    presentation: (e, def) => ({ label: def.toUpperCase(), iconKey: `k_${e.concept}` }),
  }).Project(entity('t.c1'))
  expect(injected.presentation.label).toBe('C ONE')
  expect(injected.presentation.iconKey).toBe('k_t.component')
  expect(injected.refs.implementedBy![0]!.presentation.iconKey).toBe('k_t.technology')
})
