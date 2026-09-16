import { describe, test } from 'vitest'
import assert from 'node:assert/strict'

import { SavePresetPromptModel, type SavePresetChoice } from '../save-preset-prompt.js'
import { PresetScope } from '../preset-scope.js'

const ALL = [PresetScope.Global, PresetScope.Project, PresetScope.Diagram]

// The dialog content VM: a name field + a "Save to" scope picker + Confirm/
// Cancel that close with { name, scope } (or undefined). Tested directly via the
// `close` callback.
describe('SavePresetPromptModel', () => {

    test('starts with the initial name and pre-selects the initial scope', () => {
        const m = new SavePresetPromptModel('Wide', ALL, PresetScope.Project, () => {})
        assert.equal(m.Name, 'Wide')
        assert.equal(m.CanConfirm, true)
        assert.equal(m.SelectedScope?.Scope, PresetScope.Project)
    })

    test('offers exactly the scopes passed in', () => {
        const m = new SavePresetPromptModel('x', [PresetScope.Global, PresetScope.Diagram], PresetScope.Global, () => {})
        assert.deepEqual(m.Scopes.ToArray().map((o) => o.Scope), [PresetScope.Global, PresetScope.Diagram])
    })

    test('confirm closes with the trimmed name and selected scope', () => {
        let closed: SavePresetChoice | undefined
        const m = new SavePresetPromptModel('', ALL, PresetScope.Global, (c) => { closed = c })
        m.Name = '  Tall  '
        m.SelectedScope = m.Scopes.ToArray().find((o) => o.Scope === PresetScope.Diagram)
        m.ConfirmCommand.Execute(undefined)
        assert.deepEqual(closed, { name: 'Tall', scope: PresetScope.Diagram })
    })

    test('cancel closes with undefined', () => {
        let closed: SavePresetChoice | undefined = { name: 'sentinel', scope: PresetScope.Global }
        const m = new SavePresetPromptModel('x', ALL, PresetScope.Global, (c) => { closed = c })
        m.CancelCommand.Execute(undefined)
        assert.equal(closed, undefined)
    })

    test('CanConfirm is false for an empty or blank name; confirm is a no-op then', () => {
        let called = false
        const m = new SavePresetPromptModel('', ALL, PresetScope.Global, () => { called = true })
        assert.equal(m.CanConfirm, false)
        m.Name = '   '
        assert.equal(m.CanConfirm, false)
        m.ConfirmCommand.Execute(undefined)
        assert.equal(called, false)
    })
})
