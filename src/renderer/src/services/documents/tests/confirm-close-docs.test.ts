import { describe, it, expect, vi } from 'vitest'
import { confirmCloseDocs } from '../confirm-close-docs.js'
import { SavePromptResult } from '../../dialogs/save-prompt-model.js'

function doc(dirty: boolean) { return { Id: 'x', Title: 'x', IsDirty: dirty, Save: vi.fn() } }
function host(docs: ReturnType<typeof doc>[], saveAll = vi.fn(async () => {})) {
    return { OpenDocuments: { ToArray: () => docs }, SaveAll: saveAll }
}

describe('confirmCloseDocs', () => {
    it('no dirty docs → true, no dialog', async () => {
        const saveAll = vi.fn(async () => {})
        const prompt = vi.fn()
        expect(await confirmCloseDocs(host([doc(false)], saveAll) as never, undefined, prompt as never)).toBe(true)
        expect(prompt).not.toHaveBeenCalled()
        expect(saveAll).not.toHaveBeenCalled()
    })
    it('Save All → SaveAll then true', async () => {
        const saveAll = vi.fn(async () => {})
        const prompt = vi.fn(async () => SavePromptResult.Save)
        expect(await confirmCloseDocs(host([doc(true)], saveAll) as never, undefined, prompt as never)).toBe(true)
        expect(saveAll).toHaveBeenCalled()
    })
    it('Discard All → true, no save', async () => {
        const saveAll = vi.fn(async () => {})
        const prompt = vi.fn(async () => SavePromptResult.DontSave)
        expect(await confirmCloseDocs(host([doc(true)], saveAll) as never, undefined, prompt as never)).toBe(true)
        expect(saveAll).not.toHaveBeenCalled()
    })
    it('Cancel → false', async () => {
        const prompt = vi.fn(async () => SavePromptResult.Cancel)
        expect(await confirmCloseDocs(host([doc(true)]) as never, undefined, prompt as never)).toBe(false)
    })
    it('summarizes a multi-doc message', async () => {
        const prompt = vi.fn(async (_d: unknown, _o: { message: string; dontSaveLabel: string; autoCloseSeconds?: number }) => SavePromptResult.DontSave)
        await confirmCloseDocs(host([doc(true), doc(true)]) as never, undefined, prompt as never)
        expect(prompt.mock.calls[0][1].message).toContain('2 documents')
    })
    it('arms the 10s Discard-All auto-close on the prompt', async () => {
        const prompt = vi.fn(async (_d: unknown, _o: { message: string; dontSaveLabel: string; autoCloseSeconds?: number }) => SavePromptResult.DontSave)
        await confirmCloseDocs(host([doc(true)]) as never, undefined, prompt as never)
        expect(prompt.mock.calls[0][1].autoCloseSeconds).toBe(10)
        expect(prompt.mock.calls[0][1].dontSaveLabel).toBe('Discard All')
    })
})
