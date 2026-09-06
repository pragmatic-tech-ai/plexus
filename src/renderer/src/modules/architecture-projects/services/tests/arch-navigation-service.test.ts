import { test, expect } from 'vitest'
import type { Element } from '@pragmatic-tech-ai/todl'
import { ArchNavigationService, NavTargetKind } from '../arch-navigation-service.js'
import type { ArchModel } from '../arch-model.js'

// Build a fake Element (id/concept/fields/refs) — the resolver reads only these.
function el(id: string, concept: string, label: string, refs: Record<string, Element[]> = {}): Element {
  return { id, concept, fields: { label }, refs } as unknown as Element
}

// A resolver whose elementFor returns hand-built Elements, so resolveTargets'
// LOGIC (which members it reads, cardinality, adaptivity per concept) is tested
// without depending on the TODL compiler / source syntax.
class FakeNav extends ArchNavigationService {
  public constructor(private readonly els: Map<string, Element>) { super({ get: () => undefined } as never) }
  protected override elementFor(_model: ArchModel, id: string): Element | undefined { return this.els.get(id) }
}

const backend = el('categories.backend', 'category', 'Backend')
const data = el('categories.data', 'category', 'Data')
const dotnet = el('tech.dotnet', 'technology', '.NET', { applicable_to: [backend, data] })
const orders = el('orders', 'component', 'Orders', { implemented_by: [dotnet], category: [backend] })

function navWith(...elements: Element[]): FakeNav {
  return new FakeNav(new Map(elements.map((e) => [e.id, e])))
}
// resolveTargets scans model.entities() for scenario participation; the resolver
// tests don't exercise scenarios, so a model with no entities suffices.
const MODEL = { entities: () => [] } as unknown as ArchModel

test('a component resolves itself + its single technology + its direct category', () => {
  const t = navWith(orders, dotnet, backend, data).resolveTargets(MODEL, 'orders')
  expect(t.component?.kind).toBe(NavTargetKind.Component)
  expect(t.component?.id).toBe('orders')
  expect(t.technologies.map((x) => x.id)).toEqual(['tech.dotnet'])
  expect(t.technologies[0]?.label).toBe('.NET')
  expect(t.categories.map((x) => x.id)).toEqual(['categories.backend'])
})

test('a component with no direct category falls back to its technology applicable_to', () => {
  const api = el('api', 'component', 'Api', { implemented_by: [dotnet] })
  const t = navWith(api, dotnet, backend, data).resolveTargets(MODEL, 'api')
  expect(t.categories.map((x) => x.id)).toEqual(['categories.backend', 'categories.data'])
})

test('a technology node resolves itself + its applicable_to categories (the multi case)', () => {
  const t = navWith(dotnet, backend, data).resolveTargets(MODEL, 'tech.dotnet')
  expect(t.component).toBeUndefined()
  expect(t.technologies.map((x) => x.id)).toEqual(['tech.dotnet'])
  expect(t.categories.map((x) => x.id)).toEqual(['categories.backend', 'categories.data'])
})

test('a category node resolves only itself', () => {
  const t = navWith(backend).resolveTargets(MODEL, 'categories.backend')
  expect(t.component).toBeUndefined()
  expect(t.technologies).toEqual([])
  expect(t.categories.map((x) => x.id)).toEqual(['categories.backend'])
})

test('an unknown id yields empty targets', () => {
  const t = navWith(orders).resolveTargets(MODEL, 'ghost')
  expect(t.component).toBeUndefined()
  expect(t.technologies).toEqual([])
  expect(t.categories).toEqual([])
})

// ── scenario participation ─────────────────────────────────────────────────
// A minimal Entity/FlowEntity: id + concept + field(label) + refs(member).
function scEnt(id: string, concept: string, refs: Record<string, any[]>, label?: string): any {
  return { id, concept, field: (n: string) => (n === 'label' ? label : undefined), refs: (m: string) => refs[m] ?? [] }
}
// scenario X { sequences = [sequence { steps = [a ==> b, b ==> c] }] }
function scenario(id: string, label: string, edges: Array<[string, string]>): any {
  const steps = edges.map(([s, d], i) => scEnt(`${id}#step${i}`, 'step', { src: [scEnt(s, 'component', {})], dst: [scEnt(d, 'component', {})] }))
  return scEnt(id, 'scenario', { sequences: [scEnt(`${id}#seq`, 'sequence', { steps })] }, label)
}
// A resolver over a fixed entity set; elementFor still returns undefined (the
// scenario path is independent of the clicked element).
class ScenarioNav extends ArchNavigationService {
  public constructor() { super({ get: () => undefined } as never) }
  protected override elementFor(): Element | undefined { return undefined }
}
function scenarioModel(...ents: any[]): ArchModel { return { entities: () => ents } as unknown as ArchModel }

test('a node resolves the scenarios it participates in (step src/dst), by count', () => {
  const conv = scenario('conversational', 'Conversational', [['business_user', 'chat_surface'], ['chat_surface', 'business_agent']])
  const support = scenario('support_ticket', 'Support Ticket', [['business_user', 'chat_surface']])
  const nav = new ScenarioNav()
  const t = nav.resolveTargets(scenarioModel(conv, support), 'business_user')
  expect(t.scenarios.map((s) => s.id)).toEqual(['conversational', 'support_ticket'])
  expect(t.scenarios[0]?.kind).toBe(NavTargetKind.Scenario)
  expect(t.scenarios[0]?.label).toBe('Conversational')
})

test('a node in no scenario resolves an empty scenario list', () => {
  const conv = scenario('conversational', 'Conversational', [['a', 'b']])
  const nav = new ScenarioNav()
  expect(nav.resolveTargets(scenarioModel(conv), 'ghost').scenarios).toEqual([])
})

// ── navigateTo: provenance fork ────────────────────────────────────────────
import { WikiOriginKind } from '../../../../services/projects/wiki-origin.js'
import { NavTargetKind as Kind } from '../arch-navigation-service.js'

// A routing harness: overrides the two navigator seams + activation so the fork
// logic is verified independent of the real services.
function routing(origin: 'published' | 'project') {
  const opened: Array<{ p: string; u: string; l: number }> = []
  const revealed: string[] = []
  let activated = false
  class RouteNav extends ArchNavigationService {
    public constructor() { super({ get: () => undefined } as never) }
    protected override resolveExplorer() { return { OpenFileInProject: (p: string, u: string, l: number) => { opened.push({ p, u, l }); return Promise.resolve() } } }
    protected override resolveLibraries() { return { RevealTerm: (t: string) => { revealed.push(t); return true } } }
    protected override activateLibraries() { activated = true }
  }
  const model = {
    wikiOriginOf: () => (origin === 'published' ? { kind: WikiOriginKind.Package, backend: 'library', id: 'tech', version: '1.0' } : undefined),
    homeOf: () => (origin === 'project' ? 'landscape.todl' : undefined),
    Storage: { ReadText: () => Promise.resolve('namespace x {\n  component orders { }\n}\n') },
  } as never
  return { nav: new RouteNav(), model, opened, revealed, get activated() { return activated } }
}

test('a published target reveals in the Libraries panel (and activates it)', async () => {
  const h = routing('published')
  await h.nav.navigateTo(h.model, 'proj', { kind: Kind.Technology, id: 'tech.dotnet', concept: 'technology', label: '.NET' })
  expect(h.revealed).toEqual(['tech.dotnet'])
  expect(h.activated).toBe(true)
  expect(h.opened).toEqual([])
})

test('a project target opens the .todl source at the declaration line', async () => {
  const h = routing('project')
  await h.nav.navigateTo(h.model, 'proj', { kind: Kind.Component, id: 'orders', concept: 'component', label: 'Orders' })
  expect(h.revealed).toEqual([])
  expect(h.opened.length).toBe(1)
  expect(h.opened[0]!.u).toBe('landscape.todl')
  expect(h.opened[0]!.l).toBe(2) // 1-based line of "component orders"
})
