import { test, expect } from 'vitest'
import { SkillInputFormVm } from '../skill-input-form.js'
import { InputKind, type SkillInput } from '../../../../../../shared/skill-api.js'
import type { ResolvedInput } from '../../../../../../shared/skill-context-api.js'

const inputs: SkillInput[] = [
    { key: 'vp', label: 'Viewpoint', type: InputKind.Enum, options: ['a', 'b'], required: true, default: 'a' },
    { key: 'flag', label: 'Flag', type: InputKind.Bool, default: false },
]

test('confirm collects values when valid', () => {
    let result: ResolvedInput[] | undefined = []
    const vm = new SkillInputFormVm(inputs, (r) => { result = r })
    expect(vm.IsValid).toBe(true)
    vm.ConfirmCommand.Execute(undefined)
    expect(result).toEqual([{ key: 'vp', value: 'a' }, { key: 'flag', value: false }])
})

test('confirm is a no-op while invalid (required empty)', () => {
    let called = false
    const vm = new SkillInputFormVm(inputs, () => { called = true })
    vm.Inputs.Get(0)!.Value = ''            // required Enum now empty
    expect(vm.IsValid).toBe(false)
    vm.ConfirmCommand.Execute(undefined)
    expect(called).toBe(false)
})

test('cancel yields undefined', () => {
    let result: ResolvedInput[] | undefined = []
    const vm = new SkillInputFormVm(inputs, (r) => { result = r })
    vm.CancelCommand.Execute(undefined)
    expect(result).toBeUndefined()
})
