import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { ViewpointPickerModel } from '../viewpoint-picker.js'

// The dialog content VM: rows + Confirm/Cancel that close with the result the
// host (DialogService) resolves. Tested directly via the `close` callback.
describe('ViewpointPickerModel', () => {

    test('pre-selects the given ids', () => {
        const m = new ViewpointPickerModel(['a', 'b', 'c'], new Set(['b']), () => {})
        assert.deepEqual(m.Rows.ToArray().map((r) => r.IsSelected), [false, true, false])
    })

    test('no pre-selection checks all rows', () => {
        const m = new ViewpointPickerModel(['a', 'b'], undefined, () => {})
        assert.deepEqual(m.Rows.ToArray().map((r) => r.IsSelected), [true, true])
    })

    test('confirm closes with the checked labels', () => {
        let closed: string[] | undefined = ['sentinel']
        const m = new ViewpointPickerModel(['a', 'b', 'c'], new Set(['a', 'c']), (ids) => { closed = ids })
        m.ConfirmCommand.Execute(undefined)
        assert.deepEqual(closed, ['a', 'c'])
    })

    test('cancel closes with undefined', () => {
        let closed: string[] | undefined = ['sentinel']
        const m = new ViewpointPickerModel(['a', 'b'], undefined, (ids) => { closed = ids })
        m.CancelCommand.Execute(undefined)
        assert.equal(closed, undefined)
    })

    test('CanConfirm tracks whether at least one row is selected', () => {
        const m = new ViewpointPickerModel(['a'], new Set(), () => {})
        assert.equal(m.CanConfirm, false)
        m.Rows.Get(0)!.IsSelected = true
        assert.equal(m.CanConfirm, true)
    })

    test('confirm is a no-op while nothing is selected', () => {
        let called = false
        const m = new ViewpointPickerModel(['a'], new Set(), () => { called = true })
        m.ConfirmCommand.Execute(undefined)
        assert.equal(called, false)
    })
    // The Confirm button binds Command only: its enabled state is the command's CanExecute, so the
    // command must report the >=1 rule and raise CanExecuteChanged when it flips.
    test('ConfirmCommand.CanExecute carries the >=1 rule and raises CanExecuteChanged on each flip', () => {
        const m = new ViewpointPickerModel(['a', 'b'], new Set(), () => {})
        let raised = 0
        m.ConfirmCommand.AddCanExecuteChangedListener(() => { raised++ })
        assert.equal(m.ConfirmCommand.CanExecute(undefined), false)
        m.Rows.Get(0)!.IsSelected = true
        assert.equal(m.ConfirmCommand.CanExecute(undefined), true)
        assert.equal(raised, 1)
        m.Rows.Get(1)!.IsSelected = true
        assert.equal(raised, 1, 'no change, no notification')
        m.Rows.Get(0)!.IsSelected = false
        m.Rows.Get(1)!.IsSelected = false
        assert.equal(m.ConfirmCommand.CanExecute(undefined), false)
        assert.equal(raised, 2)
    })
})
