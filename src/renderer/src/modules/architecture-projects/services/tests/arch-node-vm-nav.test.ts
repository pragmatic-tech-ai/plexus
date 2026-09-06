import { test, expect } from 'vitest'
import { ArchNodeVM } from '../arch-node-vm.js'
import { NavTargetKind, type NavTarget, type NavTargets } from '../arch-navigation-service.js'

// Build a NavTarget quickly.
function target(kind: NavTargetKind, id: string, label: string): NavTarget {
  return { kind, id, concept: kind, label }
}

const COMPONENT = target(NavTargetKind.Component, 'orders', 'Orders')
const DOTNET = target(NavTargetKind.Technology, 'tech.dotnet', '.NET')
const NODE = target(NavTargetKind.Technology, 'tech.node', 'Node.js')
const BACKEND = target(NavTargetKind.Category, 'categories.backend', 'Backend')
const DATA = target(NavTargetKind.Category, 'categories.data', 'Data')

function targets(over: Partial<NavTargets> = {}): NavTargets {
  return { technologies: [], categories: [], ...over }
}

test('a component target enables Go to Component and its command runs the target', () => {
  const runs: NavTarget[] = []
  const vm = new ArchNodeVM()
  vm.ApplyNavTargets(targets({ component: COMPONENT }), (t) => runs.push(t))
  expect(vm.CanGoToComponent).toBe(true)
  vm.GoToComponentCommand?.Execute(undefined)
  expect(runs).toEqual([COMPONENT])
})

test('a single technology is a flat item: HasOne true, HasMany false, single command runs it', () => {
  const runs: NavTarget[] = []
  const vm = new ArchNodeVM()
  vm.ApplyNavTargets(targets({ technologies: [DOTNET] }), (t) => runs.push(t))
  expect(vm.HasTechnologies).toBe(true)
  expect(vm.HasOneTechnology).toBe(true)
  expect(vm.HasManyTechnologies).toBe(false)
  vm.SingleTechnologyCommand?.Execute(undefined)
  expect(runs).toEqual([DOTNET])
})

test('many technologies become a submenu: HasMany true, each item command runs its own target', () => {
  const runs: NavTarget[] = []
  const vm = new ArchNodeVM()
  vm.ApplyNavTargets(targets({ technologies: [DOTNET, NODE] }), (t) => runs.push(t))
  expect(vm.HasTechnologies).toBe(true)
  expect(vm.HasOneTechnology).toBe(false)
  expect(vm.HasManyTechnologies).toBe(true)
  expect([...vm.Technologies].map((i) => i.Name)).toEqual(['.NET', 'Node.js'])
  vm.Technologies.Get(1)!.GoCommand.Execute(undefined)
  expect(runs).toEqual([NODE])
})

test('categories mirror the technology cardinality logic', () => {
  const runs: NavTarget[] = []
  const vm = new ArchNodeVM()
  vm.ApplyNavTargets(targets({ categories: [BACKEND, DATA] }), (t) => runs.push(t))
  expect(vm.HasCategories).toBe(true)
  expect(vm.HasOneCategory).toBe(false)
  expect(vm.HasManyCategories).toBe(true)
  expect([...vm.Categories].map((i) => i.Name)).toEqual(['Backend', 'Data'])

  const one = new ArchNodeVM()
  one.ApplyNavTargets(targets({ categories: [BACKEND] }), (t) => runs.push(t))
  expect(one.HasOneCategory).toBe(true)
  expect(one.HasManyCategories).toBe(false)
  one.SingleCategoryCommand?.Execute(undefined)
  expect(runs).toEqual([BACKEND])
})

test('empty targets clear every flag and HasNavTargets is false', () => {
  const vm = new ArchNodeVM()
  vm.ApplyNavTargets(targets({ component: COMPONENT, technologies: [DOTNET] }), () => {})
  vm.ApplyNavTargets(targets(), () => {})
  expect(vm.CanGoToComponent).toBe(false)
  expect(vm.HasTechnologies).toBe(false)
  expect(vm.HasCategories).toBe(false)
  expect(vm.Technologies.Count).toBe(0)
  expect(vm.HasNavTargets).toBe(false)
})

test('HasNavTargets is true when any relation resolves', () => {
  const vm = new ArchNodeVM()
  vm.ApplyNavTargets(targets({ categories: [BACKEND] }), () => {})
  expect(vm.HasNavTargets).toBe(true)
})
