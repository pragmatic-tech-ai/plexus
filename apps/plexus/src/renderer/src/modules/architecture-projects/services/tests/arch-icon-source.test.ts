import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft, type Entity } from '@pragmatic-tech-ai/todl'
import { iconEntityKey } from '../arch-icon.js'

// component: implementedBy (order 1) and categorisedAs (order 2) both declare iconSource.
const MM = `namespace t {
  concept category {}
  concept technology {}
  concept component {
    relationship implementedBy -> technology { annotate iconSource { order = 1; } }
    relationship categorisedAs -> category { annotate iconSource { order = 2; } }
  }
  taxonomy Cats : represents category { term ai {} }
  taxonomy Stack : represents technology { term azure {} }
  viewpoint V : frames component
}`

function repoWith(icons: string[], model: string): { repo: Repository; entity: (id: string) => Entity } {
    const mmDoc = toJSON(load([{ uri: 'mm.todl', text: MM }]).model)
    for (const target of icons)
        mmDoc.nodes.push({ id: `${target}@icon`, tier: 'Ontology', typeOf: 'icon', attrs: { path: `resources/${target}.svg` } })
    const baseRepo = new Repository(graphFromJSON(mmDoc))
    const draft = ModelDraft.fromSources([baseRepo], [{ uri: 'a.todl', text: model }], { namespace: 't' })
    const insts = new Map(draft.ownInstances().map((e) => [e.id, e]))
    return { repo: draft.model, entity: (id) => insts.get(id)! }
}

const BODY = `namespace t { model M : t conforms V { component c1 { implementedBy = Stack.azure; categorisedAs = Cats.ai; } } }`

test('own icon wins even when iconSource members are declared', () => {
    const { repo, entity } = repoWith(['component', 'Stack.azure', 'Cats.ai'], BODY)
    expect(iconEntityKey(repo, entity('c1'))).toBe('component')
})

test('lowest-order iconSource member with an icon wins (implementedBy before categorisedAs)', () => {
    const { repo, entity } = repoWith(['Stack.azure', 'Cats.ai'], BODY)
    expect(iconEntityKey(repo, entity('c1'))).toBe('Stack.azure')
})

test('a higher-order source is used when the lower-order target has no icon', () => {
    const { repo, entity } = repoWith(['Cats.ai'], BODY)
    expect(iconEntityKey(repo, entity('c1'))).toBe('Cats.ai')
})

test('iconSource declared but no target (nor own) bears an icon yields undefined', () => {
    const { repo, entity } = repoWith([], BODY)
    expect(iconEntityKey(repo, entity('c1'))).toBeUndefined()
})
