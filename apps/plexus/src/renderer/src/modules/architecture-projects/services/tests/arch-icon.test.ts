import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft, type Entity } from '@pragmatic-tech-ai/todl'
import { iconEntityKey } from '../arch-icon.js'

// Build a repo whose base carries `<id>@icon` annotation nodes — the SOURCE shape a
// meta-model/library declares (`annotate icon { path = … }`): an id `<target>@icon`,
// typeOf 'icon', attrs.path. (No `key`: that is stamped only at publish, and the arch
// project loads bases from source.) Own instances reference the terms.
const MM = `namespace t {
  concept technology {}
  concept component { relationship realisedBy -> technology; }
  concept lonely {}
  taxonomy Stack : represents technology { term azure {} }
  viewpoint V : frames component, lonely
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

test('a referenced term with an icon annotation wins (component -> realisedBy -> azure)', () => {
    const { repo, entity } = repoWith(
        ['Stack.azure'],
        `namespace t { model M : t conforms V { component c1 { realisedBy = Stack.azure; } } }`,
    )
    expect(iconEntityKey(repo, entity('c1'))).toBe('Stack.azure')
})

test("the entity's own concept is the fallback when no reference carries an icon", () => {
    const { repo, entity } = repoWith(
        ['component'],
        `namespace t { model M : t conforms V { component c1 {} } }`,
    )
    expect(iconEntityKey(repo, entity('c1'))).toBe('component')
})

test('a referenced term is preferred over the own concept', () => {
    const { repo, entity } = repoWith(
        ['Stack.azure', 'component'],
        `namespace t { model M : t conforms V { component c1 { realisedBy = Stack.azure; } } }`,
    )
    expect(iconEntityKey(repo, entity('c1'))).toBe('Stack.azure')
})

test('an entity with no icon-bearing reference or concept yields undefined', () => {
    const { repo, entity } = repoWith(
        [],
        `namespace t { model M : t conforms V { lonely x {} } }`,
    )
    expect(iconEntityKey(repo, entity('x'))).toBeUndefined()
})

// Direction precedence: when several referenced terms carry icons, the winner is
// the PROPAGATION SOURCE — a term that references another candidate term. Here
// component lists categorisedAs BEFORE implementedBy, so raw schema order would
// pick the category; the technology term references the category term, so the
// technology must win regardless of order.
const DIR_MM = `namespace t {
  concept category {}
  concept technology { relationship applicableTo -> category; }
  concept component {
    relationship categorisedAs -> category;
    relationship implementedBy -> technology;
  }
  taxonomy Cats : represents category { term ai {} }
  taxonomy Stack : represents technology { term azure { applicableTo = Cats.ai; } }
  viewpoint V : frames component
}`

function dirRepoWith(icons: string[]): { repo: Repository; entity: (id: string) => Entity } {
    const mmDoc = toJSON(load([{ uri: 'dir.todl', text: DIR_MM }]).model)
    for (const target of icons)
        mmDoc.nodes.push({ id: `${target}@icon`, tier: 'Ontology', typeOf: 'icon', attrs: { path: `resources/${target}.svg` } })
    const baseRepo = new Repository(graphFromJSON(mmDoc))
    const model = `namespace t { model M : t conforms V { component c1 { categorisedAs = Cats.ai; implementedBy = Stack.azure; } } }`
    const draft = ModelDraft.fromSources([baseRepo], [{ uri: 'a.todl', text: model }], { namespace: 't' })
    const insts = new Map(draft.ownInstances().map((e) => [e.id, e]))
    return { repo: draft.model, entity: (id) => insts.get(id)! }
}

test('the propagation source (technology) outranks the back-filled category, beating schema order', () => {
    const { repo, entity } = dirRepoWith(['Stack.azure', 'Cats.ai'])
    expect(iconEntityKey(repo, entity('c1'))).toBe('Stack.azure')
})

test('with no propagation link, the first icon-bearing member in schema order wins', () => {
    // Only the category carries an icon → it is the sole candidate.
    const { repo, entity } = dirRepoWith(['Cats.ai'])
    expect(iconEntityKey(repo, entity('c1'))).toBe('Cats.ai')
})

test('a placed taxonomy archetype draws its OWN icon (own-id wins over concept)', () => {
    // The dropped-as-node case: the entity IS the icon-bearing term (Stack.azure@icon),
    // reachable only by its own id — not via type/concept (technology, no icon) or refs.
    const { repo } = repoWith(['Stack.azure'], `namespace t { model M : t conforms V {} }`)
    const term = repo.entity('Stack.azure')
    expect(term).toBeDefined()
    expect(iconEntityKey(repo, term!)).toBe('Stack.azure')
})
