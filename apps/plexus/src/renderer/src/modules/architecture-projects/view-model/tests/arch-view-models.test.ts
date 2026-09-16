import { test, expect } from 'vitest'
import type { Element } from '@pragmatic-tech-ai/todl'
import { toViewModel } from '../element-view-model.js'
import { Component, Technology, Category, registerArchViewModels } from '../arch-view-models.js'

registerArchViewModels()

function el(partial: Partial<Element> & Pick<Element, 'id' | 'concept'>): Element {
  return {
    fields: {}, refs: {},
    schema: { concept: partial.concept, extends: null, fields: [], relationships: [] },
    provenance: {}, presentation: { label: partial.id },
    ...partial,
  } as Element
}

test('Component exposes typed name / implementedBy / cat / hostedIn', () => {
  const azure = el({ id: 'Stack.azure', concept: 'technology', fields: { label: 'Azure' } })
  const ai = el({ id: 'Cats.ai', concept: 'category', fields: { label: 'AI' } })
  const cloud = el({ id: 'Stack.cloud', concept: 'technology', fields: { label: 'Cloud' } })
  const c1 = el({
    id: 'c1', concept: 'component', fields: { name: 'C One' },
    refs: { implementedBy: [azure], categorisedAs: [ai], hostedIn: [cloud] },
  })

  const vm = toViewModel(c1) as Component
  expect(vm).toBeInstanceOf(Component)
  expect(vm.name).toBe('C One')
  expect(vm.implementedBy[0]).toBeInstanceOf(Technology)
  expect(vm.implementedBy[0].name).toBe('Azure')
  expect(vm.cat).toBeInstanceOf(Category)
  expect(vm.cat!.name).toBe('AI')
  expect(vm.hostedIn!.name).toBe('Cloud')
})

test('cat is undefined when no categorisedAs edge is present', () => {
  const vm = toViewModel(el({ id: 'c2', concept: 'component', fields: { name: 'C Two' } })) as Component
  expect(vm.cat).toBeUndefined()
})
