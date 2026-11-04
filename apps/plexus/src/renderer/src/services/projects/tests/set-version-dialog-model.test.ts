import { test, expect } from 'vitest'
import { SetVersionDialogModel, type SetVersionResult } from '@pragmatic-tech-ai/plexus-core/renderer/projects/set-version-dialog-model.js'

test('prefills NewVersion with the current version and can confirm', () => {
    const vm = new SetVersionDialogModel('0.1.0', () => {})
    expect(vm.Current).toBe('0.1.0')
    expect(vm.NewVersion).toBe('0.1.0')
    expect(vm.CanConfirm).toBe(true)
})

test('CanConfirm tracks validity; empty shows no error, invalid does', () => {
    const vm = new SetVersionDialogModel('0.1.0', () => {})
    vm.NewVersion = ''
    expect(vm.CanConfirm).toBe(false)
    expect(vm.Error).toBe('')
    vm.NewVersion = 'a/b'
    expect(vm.CanConfirm).toBe(false)
    expect(vm.Error).not.toBe('')
})

test('Confirm closes with a trimmed version + the publish flag; Cancel closes undefined', () => {
    let result: SetVersionResult | undefined = { version: 'sentinel', publish: false }
    const vm = new SetVersionDialogModel('0.1.0', (r) => { result = r })
    vm.NewVersion = ' 0.2.0 '
    vm.Publish = true
    vm.ConfirmCommand.Execute(undefined)
    expect(result).toEqual({ version: '0.2.0', publish: true })

    result = { version: 'sentinel', publish: false }
    vm.CancelCommand.Execute(undefined)
    expect(result).toBeUndefined()
})

// The button binds Command only (mural >= 0.66.2 disables a button whose command cannot run), so
// the command's CanExecute carries the rule and raises CanExecuteChanged when it flips.
test('ConfirmCommand.CanExecute follows CanConfirm and raises CanExecuteChanged on each flip', () => {
    const vm = new SetVersionDialogModel('0.1.0', () => {})
    let raised = 0
    vm.ConfirmCommand.AddCanExecuteChangedListener(() => { raised++ })
    expect(vm.ConfirmCommand.CanExecute(undefined)).toBe(true)
    vm.NewVersion = 'a/b'
    expect(vm.ConfirmCommand.CanExecute(undefined)).toBe(false)
    expect(raised).toBe(1)
    vm.NewVersion = '0.2.0'
    expect(vm.ConfirmCommand.CanExecute(undefined)).toBe(true)
    expect(raised).toBe(2)
})
