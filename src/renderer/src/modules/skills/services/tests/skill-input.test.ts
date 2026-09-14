import { test, expect } from 'vitest'
import { SkillInputVm } from '../skill-input.js'
import { InputKind, type SkillInput } from '../../../../../../shared/skill-api.js'

const enumInput: SkillInput = { key: 'vp', label: 'Viewpoint', type: InputKind.Enum, options: ['a', 'b'], required: true, default: 'a' }

test('seeds Value from default and validates required', () => {
    const vm = new SkillInputVm(enumInput)
    expect(vm.Value).toBe('a')
    expect(vm.IsValid).toBe(true)
    vm.Value = ''
    expect(vm.IsValid).toBe(false)     // required + empty
})

test('non-required input with no default is valid empty', () => {
    const vm = new SkillInputVm({ key: 'k', label: 'K', type: InputKind.Text })
    expect(vm.Value).toBe('')
    expect(vm.IsValid).toBe(true)
})

test('bool input seeds false when no default', () => {
    const vm = new SkillInputVm({ key: 'b', label: 'B', type: InputKind.Bool })
    expect(vm.Value).toBe(false)
})
