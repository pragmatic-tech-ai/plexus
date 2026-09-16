import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft, type Entity } from '@pragmatic-tech-ai/todl'
import { resolveElementPresentation } from '../element-presentation.js'
import type { TodlPresentationRegistry } from '../../../diagram/services/todl-presentation-registry.js'

const MM = `namespace t {
  concept category {}
  concept component { relationship categorisedAs -> category; }
  taxonomy Cats : represents category { term ai {} }
  viewpoint V : frames component
}`
const MODEL = `namespace t { model M : t conforms V { component c1 { categorisedAs = Cats.ai; } component c2 {} } }`

function setup() {
  // Seed a source `<term>@icon` node so iconEntityKey treats Cats.ai as
  // icon-bearing (mirrors arch-icon.test's base shape).
  const mmDoc = toJSON(load([{ uri: 'mm.todl', text: MM }]).model)
  mmDoc.nodes.push({ id: 'Cats.ai@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'resources/ai.svg' } })
  const base = new Repository(graphFromJSON(mmDoc))
  const draft = ModelDraft.fromSources([base], [{ uri: 'a.todl', text: MODEL }], { namespace: 't' })
  const entity = (id: string): Entity => draft.ownInstances().find((e) => e.id === id)!
  return { repo: draft.model, entity }
}

// A fake registry that maps only the category term's mm: key to a resource key.
const registry = { iconKeyFor: (k: string) => (k === 'mm:Cats.ai' ? 'mm_icon_ai' : undefined) } as unknown as TodlPresentationRegistry

test('resolves iconKey via the registry (mm: fallback) and passes the label through', () => {
  const { repo, entity } = setup()
  const p = resolveElementPresentation(repo, registry, entity('c1'), 'C One')
  expect(p.label).toBe('C One')
  expect(p.iconKey).toBe('mm_icon_ai')
})

test('iconKey is null when nothing is icon-bearing', () => {
  const { repo, entity } = setup()
  const p = resolveElementPresentation(repo, registry, entity('c2'), 'C Two')
  expect(p.iconKey).toBeNull()
})
