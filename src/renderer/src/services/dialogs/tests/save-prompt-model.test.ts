import { describe, it, expect, vi } from 'vitest'
import { SavePromptModel, SavePromptResult, promptSave } from '../save-prompt-model.js'

describe('SavePromptModel', () => {
    it('each command closes with the matching result', () => {
        const seen: SavePromptResult[] = []
        const m = new SavePromptModel('Save changes?', 'Save', "Don't Save", (r) => seen.push(r))
        m.SaveCommand.Execute(undefined)
        m.DontSaveCommand.Execute(undefined)
        m.CancelCommand.Execute(undefined)
        expect(seen).toEqual([SavePromptResult.Save, SavePromptResult.DontSave, SavePromptResult.Cancel])
    })

    it('exposes label + message DPs the template binds', () => {
        const m = new SavePromptModel('Msg', 'Save', 'Discard', () => {})
        expect(m.Message).toBe('Msg')
        expect(m.SaveLabel).toBe('Save')
        expect(m.DontSaveLabel).toBe('Discard')
    })
})

describe('SavePromptModel auto-close', () => {
    it('counts down on the DontSave label and chooses DontSave at zero', () => {
        vi.useFakeTimers()
        try {
            const seen: SavePromptResult[] = []
            const m = new SavePromptModel('Msg', 'Save All', 'Discard All', (r) => seen.push(r), 10)
            expect(m.DontSaveLabel).toBe('Discard All (10)')
            vi.advanceTimersByTime(1000)
            expect(m.DontSaveLabel).toBe('Discard All (9)')
            vi.advanceTimersByTime(9000)
            expect(seen).toEqual([SavePromptResult.DontSave])
        } finally { vi.useRealTimers() }
    })

    it('an explicit choice before zero cancels the countdown', () => {
        vi.useFakeTimers()
        try {
            const seen: SavePromptResult[] = []
            const m = new SavePromptModel('Msg', 'Save All', 'Discard All', (r) => seen.push(r), 10)
            m.CancelCommand.Execute(undefined)
            vi.advanceTimersByTime(20000)
            expect(seen).toEqual([SavePromptResult.Cancel]) // no late auto DontSave
        } finally { vi.useRealTimers() }
    })

    it('stopAutoClose halts the timer (scrim/Escape path) and restores the label', () => {
        vi.useFakeTimers()
        try {
            const seen: SavePromptResult[] = []
            const m = new SavePromptModel('Msg', 'Save All', 'Discard All', (r) => seen.push(r), 10)
            m.stopAutoClose()
            expect(m.DontSaveLabel).toBe('Discard All')
            vi.advanceTimersByTime(20000)
            expect(seen).toEqual([])
        } finally { vi.useRealTimers() }
    })
})

describe('promptSave', () => {
    it('returns Cancel when there is no DialogService (headless/test)', async () => {
        expect(await promptSave(undefined, { title: 'T', message: 'M' })).toBe(SavePromptResult.Cancel)
    })

    it('maps a scrim-dismissed (undefined) result to Cancel', async () => {
        const dialogs = { Show: async () => undefined, Close: () => {} } as never
        expect(await promptSave(dialogs, { title: 'T', message: 'M' })).toBe(SavePromptResult.Cancel)
    })

    it('resolves the value the model closed with', async () => {
        const dialogs = { Show: async () => SavePromptResult.Save, Close: () => {} } as never
        expect(await promptSave(dialogs, { title: 'T', message: 'M' })).toBe(SavePromptResult.Save)
    })
})
