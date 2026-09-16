import { test, expect, beforeAll } from 'vitest'
import { Application } from '@pragmatic-tech-ai/mural/runtime'
import { ArchNodeVM } from '../arch-node-vm.js'

beforeAll(() => {
    Application.current = null
    new Application()
})

// IsContainer is the duck-typed flag mural's GetContainerForItemOverride (0.21.0)
// reads to realize the node as a ContentContainerFigure. The binding sets it from
// the concept; here we cover the plain DP round-trip.
test('IsContainer defaults to false', () => {
    const vm = new ArchNodeVM()
    expect(vm.IsContainer).toBe(false)
})

test('IsContainer round-trips', () => {
    const vm = new ArchNodeVM()
    vm.IsContainer = true
    expect(vm.IsContainer).toBe(true)
})
