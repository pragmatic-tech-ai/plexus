import { test, expect } from 'vitest'
import type { Element } from '@pragmatic-tech-ai/todl'
import { ElementViewModel, registerElementViewModel, toViewModel } from '../element-view-model.js'

// Minimal Element factory for VM tests (facets not under test get sane defaults).
function el(partial: Partial<Element> & Pick<Element, 'id' | 'concept'>): Element {
  return {
    fields: {}, refs: {},
    schema: { concept: partial.concept, extends: null, fields: [], relationships: [] },
    provenance: {}, presentation: { label: partial.id },
    ...partial,
  } as Element
}

class Technology extends ElementViewModel {
  get name(): string { return String(this.field('label') ?? this.label) }
}
class Component extends ElementViewModel {
  get name(): string { return String(this.field('name') ?? this.label) }
  get implementedBy(): Technology[] { return this.refs('implementedBy') as Technology[] }
}
registerElementViewModel('technology', Technology)
registerElementViewModel('component', Component)

test('toViewModel returns the registered class instance with typed accessors', () => {
  const azure = el({ id: 'Stack.azure', concept: 'technology', fields: { label: 'Azure' } })
  const c1 = el({
    id: 'c1', concept: 'component', fields: { name: 'C One' },
    presentation: { label: 'C One', iconKey: 'k' }, refs: { implementedBy: [azure] },
  })
  const vm = toViewModel(c1)
  expect(vm).toBeInstanceOf(Component)
  expect((vm as Component).name).toBe('C One')
  expect(vm.icon).toBe('k')
  const tech = (vm as Component).implementedBy
  expect(tech[0]).toBeInstanceOf(Technology)
  expect(tech[0].name).toBe('Azure')
})

test('an unregistered concept gets a generated class whose name === concept', () => {
  const vm = toViewModel(el({ id: 'w1', concept: 'widget' }))
  expect(vm).toBeInstanceOf(ElementViewModel)
  expect(vm.constructor.name).toBe('widget')
  expect(vm.id).toBe('w1')
})
