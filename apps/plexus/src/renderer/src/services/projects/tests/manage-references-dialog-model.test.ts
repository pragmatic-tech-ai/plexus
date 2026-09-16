import { test, expect } from 'vitest'

import type { BaseBindings, BaseRef } from '../base-binding.js'
import { ManageReferencesDialogModel } from '../manage-references-dialog-model.js'

const ea5: BaseRef = { id: 'ea', version: '5' }
const ea6: BaseRef = { id: 'ea', version: '6' }
const aws1: BaseRef = { id: 'aws', version: '0.1.0' }
const ms1: BaseRef = { id: 'microsoft', version: '0.1.0' }
const gcp1: BaseRef = { id: 'gcp', version: '0.1.0' }

function make(
    current: BaseBindings,
    metaModels: readonly BaseRef[],
    libraries: readonly BaseRef[],
    offersLibraries: boolean,
): { vm: ManageReferencesDialogModel; closed: () => BaseBindings | undefined | 'pending' } {
    let result: BaseBindings | undefined | 'pending' = 'pending'
    const vm = new ManageReferencesDialogModel(current, metaModels, libraries, offersLibraries, (r) => { result = r })
    return { vm, closed: () => result }
}

test('lists the available meta-models and pre-selects the current one', () => {
    const { vm } = make({ metaModel: ea5, libraries: [] }, [ea5, ea6], [], true)
    expect(vm.MetaModels.ToArray().map((m) => m.Label)).toEqual(['ea @ 5', 'ea @ 6'])
    expect(vm.SelectedMetaModel?.Ref).toEqual(ea5)
    expect(vm.CanConfirm).toBe(true)
})

test('keeps a current meta-model that is no longer available (stale ref stays visible + selected)', () => {
    const stale: BaseRef = { id: 'ea', version: '9' }
    const { vm } = make({ metaModel: stale, libraries: [] }, [ea5], [], true)
    expect(vm.MetaModels.ToArray().map((m) => m.Label)).toContain('ea @ 9')
    expect(vm.SelectedMetaModel?.Ref).toEqual(stale)
})

test('pre-checks current libraries and leaves addable ones unchecked', () => {
    const { vm } = make({ metaModel: ea5, libraries: [aws1] }, [ea5], [aws1, ms1, gcp1], true)
    const rows = vm.Libraries.ToArray()
    expect(rows.map((l) => l.Label)).toEqual(['aws @ 0.1.0', 'microsoft @ 0.1.0', 'gcp @ 0.1.0'])
    expect(rows.map((l) => l.IsSelected)).toEqual([true, false, false])
    expect(vm.Result.libraries).toEqual([aws1])
})

test('checking an addable library adds it; unchecking a current one removes it', () => {
    const { vm } = make({ metaModel: ea5, libraries: [aws1] }, [ea5], [aws1, ms1], true)
    const [aws, ms] = vm.Libraries.ToArray()
    ms.IsSelected = true
    aws.IsSelected = false
    expect(vm.Result.libraries).toEqual([ms1])
})

test('changing the selected meta-model updates the result', () => {
    const { vm } = make({ metaModel: ea5, libraries: [] }, [ea5, ea6], [], true)
    vm.SelectedMetaModel = vm.MetaModels.ToArray().find((m) => m.Ref.version === '6')
    expect(vm.Result.metaModel).toEqual(ea6)
})

test('a library project shows no libraries section and omits libraries from the result', () => {
    const { vm } = make({ metaModel: ea5 }, [ea5, ea6], [aws1], false)
    expect(vm.ShowLibraries).toBe(false)
    expect(vm.Libraries.Count).toBe(0)
    expect(vm.Result).toEqual({ metaModel: ea5 })
    expect('libraries' in vm.Result).toBe(false)
})

test('Confirm closes with the result; Cancel closes with undefined', () => {
    const a = make({ metaModel: ea5, libraries: [aws1] }, [ea5], [aws1, ms1], true)
    a.vm.ConfirmCommand.Execute(undefined)
    expect(a.closed()).toEqual({ metaModel: ea5, libraries: [aws1] })

    const b = make({ metaModel: ea5, libraries: [] }, [ea5], [], true)
    b.vm.CancelCommand.Execute(undefined)
    expect(b.closed()).toBeUndefined()
})

test('dedupes a ref offered by both the published store and an open workspace project', () => {
    // aws@0.1.0 appears twice in the available list (published + workspace) → one row.
    const { vm } = make({ metaModel: ea5, libraries: [] }, [ea5], [aws1, aws1, ms1], true)
    expect(vm.Libraries.ToArray().map((l) => l.Label)).toEqual(['aws @ 0.1.0', 'microsoft @ 0.1.0'])
})
