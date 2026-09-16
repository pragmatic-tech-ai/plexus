import { test, expect } from 'vitest'
import type { CatalogStrategy, LayoutStageSpec } from '@pragmatic-tech-ai/fresco'

import { LayoutStageVM, DEFAULT_OPTION } from '../layout-stage-vm.js'

// Two strategies; the first carries a number + a boolean parameter.
const STRATEGIES = [
    { name: 'Grid', className: 'GridStrategy', parameters: [
        { key: 'gap', type: 'number', default: 10 },
        { key: 'pack', type: 'boolean', default: false },
    ] },
    { name: 'Radial', className: 'RadialStrategy', parameters: [] },
] as unknown as CatalogStrategy[]

// Build a stage capturing the last spec it emitted into the config.
function stage(): { vm: LayoutStageVM; last: () => LayoutStageSpec | undefined } {
    let last: LayoutStageSpec | undefined
    const vm = new LayoutStageVM('Layer Assigner', STRATEGIES, (spec) => { last = spec })
    return { vm, last: () => last }
}

test('LoadSpec restores the strategy AND its stored parameter values', () => {
    const { vm, last } = stage()
    vm.LoadSpec({ className: 'GridStrategy', params: { gap: 42, pack: true } })
    expect(vm.Selected).toBe('Grid')
    expect(last()).toEqual({ className: 'GridStrategy', params: { gap: 42, pack: true } })
})

test('LoadSpec(undefined) selects the framework default', () => {
    const { vm, last } = stage()
    vm.Selected = 'Grid'          // move off default first
    vm.LoadSpec(undefined)
    expect(vm.Selected).toBe(DEFAULT_OPTION)
    expect(last()).toBeUndefined()
})

test('LoadSpec with an unknown className falls back to the default', () => {
    const { vm } = stage()
    vm.LoadSpec({ className: 'GhostStrategy', params: {} })
    expect(vm.Selected).toBe(DEFAULT_OPTION)
})
