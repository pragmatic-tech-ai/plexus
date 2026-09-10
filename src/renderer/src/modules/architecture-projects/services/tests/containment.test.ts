import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'
import {
    CONTAINMENT_MEMBER_DEFAULT,
    isContainmentRelationship,
    isContainerConcept,
    containmentParentOf,
    containmentMemberFor,
    membershipFieldFor,
    containingContainerOf,
} from '../containment.js'

// Triplet: location contains component contains technology, via the default `in`
// containment member. `region` is a leaf marked @has_children by override (it is
// the target of no containment relationship).
const MM = `namespace archmm {
  concept location {}
  concept component { relationship in -> location; }
  concept technology { relationship in -> component; }
  concept region { annotate has_children {} }
  viewpoint V : frames location, component, technology, region
}`
const file = { uri: 'model.todl', text: `namespace archmm {
  model Arch : archmm conforms V { location loc {} component comp { in = loc; } }
}` }

function build(): ArchModel {
    const mmDoc = toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)
    const baseRepo = new Repository(graphFromJSON(mmDoc))
    const draft = ModelDraft.fromSources([baseRepo], [file], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
}

test('the default containment member is `in`', () => {
    expect(CONTAINMENT_MEMBER_DEFAULT).toBe('in')
})

test('isContainmentRelationship recognizes the `in` member by default', () => {
    const repo = build().repository()
    expect(isContainmentRelationship(repo, 'component', 'in')).toBe(true)
})

test('containment targets are container concepts by default', () => {
    const repo = build().repository()
    expect(isContainerConcept(repo, 'location')).toBe(true)   // target of component.in
    expect(isContainerConcept(repo, 'component')).toBe(true)  // target of technology.in
    expect(isContainerConcept(repo, 'technology')).toBe(false) // target of nothing
})

test('@has_children annotation overrides a non-target leaf into a container', () => {
    const repo = build().repository()
    expect(isContainerConcept(repo, 'region')).toBe(true)
})

test('containmentParentOf returns the container the entity`s `in` ref points at', () => {
    const m = build()
    const comp = m.entities().find((e) => e.id === 'comp')!
    const parent = containmentParentOf(m.repository(), comp)
    expect(parent?.id).toBe('loc')
})

// Self-referential containment: a concept nested in another instance of the SAME
// concept, via a `parent` relationship annotated @containment. This is what makes
// location ⊃ location ⊃ location (azure ⊃ m365 ⊃ power_platform) project as
// nesting once the tech-architecture meta-model annotates `location.parent`. The
// reader already supports it; this guards that support and documents the design.
const NEST_MM = `namespace archmm {
  concept location { relationship parent -> location? { annotate containment {} } }
  viewpoint V : frames location
}`
const nestFile = { uri: 'nest.todl', text: `namespace archmm {
  model Arch : archmm conforms V {
    location azure {}
    location m365 { parent = azure; }
    location power_platform { parent = m365; }
  }
}` }

function buildNest(): ArchModel {
    const mmDoc = toJSON(load([{ uri: 'archmm.todl', text: NEST_MM }]).model)
    const baseRepo = new Repository(graphFromJSON(mmDoc))
    const draft = ModelDraft.fromSources([baseRepo], [nestFile], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Nest'), 'archmm')
}

test('an @containment-annotated `parent` relationship is a containment member', () => {
    const repo = buildNest().repository()
    expect(isContainmentRelationship(repo, 'location', 'parent')).toBe(true)
    expect(isContainerConcept(repo, 'location')).toBe(true)   // self-target of location.parent
})

test('containmentMemberFor(location, location) is `parent` — location nests in location', () => {
    const repo = buildNest().repository()
    expect(containmentMemberFor(repo, 'location', 'location')).toBe('parent')
})

test('containmentParentOf walks the location.parent chain (azure ⊃ m365 ⊃ power_platform)', () => {
    const m = buildNest()
    const repo = m.repository()
    const byId = (id: string) => m.entities().find((e) => e.id === id)!
    expect(containmentParentOf(repo, byId('power_platform'))?.id).toBe('m365')
    expect(containmentParentOf(repo, byId('m365'))?.id).toBe('azure')
    expect(containmentParentOf(repo, byId('azure'))).toBeUndefined()
})

// A block owns two containment channels: the child-side @containment up-ref
// (`component.in_block`) AND its own forward membership list (`block.components`).
// `listed` sits in a block ONLY via the list (no in_block); `upref` sits in one
// via in_block only. Both must resolve to their block; a location a block points
// at via `in` must NOT be mistaken for being contained in that block.
const BLOCK_MM = `namespace archmm {
  concept location {}
  concept component {
    relationship in -> location?;
    relationship in_block -> block? { annotate containment {} }
  }
  concept block {
    annotate has_children {}
    relationship in -> location;
    components : component[];
  }
  viewpoint V : frames location, component, block
}`
const blockFile = { uri: 'block.todl', text: `namespace archmm {
  model Arch : archmm conforms V {
    location azure {}
    block chat_surface { in = azure; components = [listed]; }
    component listed {}
    block command_bus { in = azure; }
    component upref { in_block = command_bus; }
  }
}` }

function buildBlocks(): ArchModel {
    const mmDoc = toJSON(load([{ uri: 'archmm.todl', text: BLOCK_MM }]).model)
    const baseRepo = new Repository(graphFromJSON(mmDoc))
    const draft = ModelDraft.fromSources([baseRepo], [blockFile], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Blocks'), 'archmm')
}

test('membershipFieldFor finds a container`s forward child-list field, not its scalar/up-ref members', () => {
    const repo = buildBlocks().repository()
    expect(membershipFieldFor(repo, 'block', 'component')).toBe('components')
    // `block.in -> location` is a relationship, not a field → no location membership field.
    expect(membershipFieldFor(repo, 'block', 'location')).toBeUndefined()
})

test('containingContainerOf resolves a member listed only in the block`s `components` field', () => {
    const m = buildBlocks()
    const byId = (id: string) => m.entities().find((e) => e.id === id)!
    expect(containingContainerOf(m.repository(), byId('listed'))?.id).toBe('chat_surface')
})

test('containingContainerOf still resolves the child-side in_block up-ref', () => {
    const m = buildBlocks()
    const byId = (id: string) => m.entities().find((e) => e.id === id)!
    expect(containingContainerOf(m.repository(), byId('upref'))?.id).toBe('command_bus')
})

test('containingContainerOf does NOT treat a location as contained in blocks that point at it via `in`', () => {
    const m = buildBlocks()
    const byId = (id: string) => m.entities().find((e) => e.id === id)!
    expect(containingContainerOf(m.repository(), byId('azure'))).toBeUndefined()
})
