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
const MODEL = undefined as unknown as ArchModel

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
