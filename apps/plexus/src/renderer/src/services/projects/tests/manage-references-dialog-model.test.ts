import { test, expect } from 'vitest'

import type { BaseBindings, BaseRef } from '@pragmatic-tech-ai/plexus-core/renderer/projects/base-binding.js'
import type { ReferenceNode } from '@pragmatic-tech-ai/plexus-core/renderer/projects/reference-node.js'
import { ManageReferencesDialogModel } from '@pragmatic-tech-ai/plexus-core/renderer/projects/manage-references-dialog-model.js'

const ea5: BaseRef = { id: 'ea', version: '5' }
const ea6: BaseRef = { id: 'ea', version: '6' }
const aws1: BaseRef = { id: 'aws', version: '0.1.0' }
const ms1: BaseRef = { id: 'microsoft', version: '0.1.0' }
const gcp1: BaseRef = { id: 'gcp', version: '0.1.0' }

// The leaf rows under a named group in the consolidated References tree.
function leavesOf(vm: ManageReferencesDialogModel, group: string): ReferenceNode[]
{
    const g = vm.Roots.ToArray().find((n) => n.Label === group)
    return g !== undefined ? g.Children.ToArray() : []
}
const metaLeaves = (vm: ManageReferencesDialogModel) => leavesOf(vm, 'Meta-models')
const libLeaves = (vm: ManageReferencesDialogModel) => leavesOf(vm, 'Libraries')

function make(
    current: BaseBindings,
    metaModels: readonly BaseRef[],
    libraries: readonly BaseRef[],
    offersLibraries: boolean,
): { vm: ManageReferencesDialogModel; closed: () => BaseBindings | undefined | 'pending' }
{
    let result: BaseBindings | undefined | 'pending' = 'pending'
    const vm = new ManageReferencesDialogModel(current, metaModels, libraries, offersLibraries, (r) => { result = r })
    return { vm, closed: () => result }
}

test('lists the available meta-models and pre-checks the current one', () => {
    const { vm } = make({ metaModels: [ea5], libraries: [] }, [ea5, ea6], [], true)
    const rows = metaLeaves(vm)
    expect(rows.map((m) => m.Label)).toEqual(['ea @ 5', 'ea @ 6'])
    expect(rows.map((m) => m.IsSelected)).toEqual([true, false])
    expect(vm.Result.metaModels).toEqual([ea5])
    expect(vm.CanConfirm).toBe(true)
})

test('keeps a current meta-model that is no longer available (stale ref stays visible + checked)', () => {
    const stale: BaseRef = { id: 'ea', version: '9' }
    const { vm } = make({ metaModels: [stale], libraries: [] }, [ea5], [], true)
    const rows = metaLeaves(vm)
    expect(rows.map((m) => m.Label)).toContain('ea @ 9')
    expect(rows.find((m) => m.Label === 'ea @ 9')?.IsSelected).toBe(true)
    expect(vm.Result.metaModels).toEqual([stale])
})

test('supports multiple current meta-models, all pre-checked', () => {
    const { vm } = make({ metaModels: [ea5, ea6], libraries: [] }, [ea5, ea6], [], true)
    expect(metaLeaves(vm).map((m) => m.IsSelected)).toEqual([true, true])
    expect(vm.Result.metaModels).toEqual([ea5, ea6])
})

test('checking/unchecking meta-models edits the result set', () => {
    const { vm } = make({ metaModels: [ea5], libraries: [] }, [ea5, ea6], [], true)
    const [a, b] = metaLeaves(vm)
    b.IsSelected = true                                      // add ea@6
    expect(vm.Result.metaModels).toEqual([ea5, ea6])
    a.IsSelected = false                                     // drop ea@5
    expect(vm.Result.metaModels).toEqual([ea6])
})

test('CanConfirm requires at least one meta-model checked', () => {
    const { vm } = make({ metaModels: [ea5], libraries: [] }, [ea5, ea6], [], true)
    expect(vm.CanConfirm).toBe(true)
    for (const m of metaLeaves(vm)) m.IsSelected = false
    expect(vm.CanConfirm).toBe(false)
})

test('pre-checks current libraries and leaves addable ones unchecked', () => {
    const { vm } = make({ metaModels: [ea5], libraries: [aws1] }, [ea5], [aws1, ms1, gcp1], true)
    const rows = libLeaves(vm)
    expect(rows.map((l) => l.Label)).toEqual(['aws @ 0.1.0', 'microsoft @ 0.1.0', 'gcp @ 0.1.0'])
    expect(rows.map((l) => l.IsSelected)).toEqual([true, false, false])
    expect(vm.Result.libraries).toEqual([aws1])
})

test('checking an addable library adds it; unchecking a current one removes it', () => {
    const { vm } = make({ metaModels: [ea5], libraries: [aws1] }, [ea5], [aws1, ms1], true)
    const [aws, ms] = libLeaves(vm)
    ms.IsSelected = true
    aws.IsSelected = false
    expect(vm.Result.libraries).toEqual([ms1])
})

test('a library project shows no libraries group and omits libraries from the result', () => {
    const { vm } = make({ metaModels: [ea5] }, [ea5, ea6], [aws1], false)
    expect(vm.ShowLibraries).toBe(false)
    expect(libLeaves(vm)).toEqual([])
    expect(vm.Result).toEqual({ metaModels: [ea5] })
    expect('libraries' in vm.Result).toBe(false)
})

test('Confirm closes with the result; Cancel closes with undefined', () => {
    const a = make({ metaModels: [ea5], libraries: [aws1] }, [ea5], [aws1, ms1], true)
    a.vm.ConfirmCommand.Execute(undefined)
    expect(a.closed()).toEqual({ metaModels: [ea5], libraries: [aws1] })

    const b = make({ metaModels: [ea5], libraries: [] }, [ea5], [], true)
    b.vm.CancelCommand.Execute(undefined)
    expect(b.closed()).toBeUndefined()
})

test('dedupes a ref offered by both the published store and an open workspace project', () => {
    // aws@0.1.0 appears twice in the available list (published + workspace) → one row.
    const { vm } = make({ metaModels: [ea5], libraries: [] }, [ea5], [aws1, aws1, ms1], true)
    expect(libLeaves(vm).map((l) => l.Label)).toEqual(['aws @ 0.1.0', 'microsoft @ 0.1.0'])
})
