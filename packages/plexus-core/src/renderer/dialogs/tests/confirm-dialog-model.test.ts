import { describe, it, expect } from 'vitest'
import { ConfirmDialogModel } from '../confirm-dialog-model.js'

describe('ConfirmDialogModel', () =>
{
    it('shows Cancel by default (existing confirm + save-prompt style uses are unchanged)', () =>
    {
        const vm = new ConfirmDialogModel('Delete it?', 'Delete', () => {})
        expect(vm.ShowCancel).toBe(true)
    })

    it('ShowCancel=false makes an OK-only info dialog; Confirm still closes true', () =>
    {
        const results: boolean[] = []
        const vm = new ConfirmDialogModel('Done', 'OK', (r) => results.push(r), false)
        expect(vm.ShowCancel).toBe(false)
        vm.ConfirmCommand.Execute()
        expect(results).toEqual([true])
    })
})
