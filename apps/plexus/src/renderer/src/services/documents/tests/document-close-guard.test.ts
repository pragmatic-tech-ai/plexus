import { describe, it, expect, vi } from 'vitest'
import { DocumentCloseGuard } from '../document-close-guard.js'
import { SavePromptResult } from '../../dialogs/save-prompt-model.js'

function doc(id: string, dirty: boolean) { return { Id: id, Title: id, IsDirty: dirty, Save: vi.fn() } }
function makeHost(docs: ReturnType<typeof doc>[]) {
    return {
        OpenDocuments: { ToArray: () => docs },
        Save: vi.fn(async () => {}),
        Close: vi.fn(),
    }
}
// A guard with an injected host + a stubbed prompt returning a fixed result. The
// empty provider is never consulted because host/prompt are supplied.
function guardWith(host: ReturnType<typeof makeHost>, result: SavePromptResult) {
    return new DocumentCloseGuard(
        { get: () => undefined } as never,
        { host: host as never, prompt: async () => result })
}

describe('DocumentCloseGuard.TryCloseDocument', () => {
    it('closes a clean doc without prompting', async () => {
        const host = makeHost([]); const d = doc('a', false)
        const g = guardWith(host, SavePromptResult.Cancel)  // prompt must not be reached
        expect(await g.TryCloseDocument(d as never)).toBe(true)
        expect(host.Close).toHaveBeenCalledWith(d)
        expect(host.Save).not.toHaveBeenCalled()
    })

    it('Save → saves then closes', async () => {
        const host = makeHost([]); const d = doc('a', true)
        const g = guardWith(host, SavePromptResult.Save)
        expect(await g.TryCloseDocument(d as never)).toBe(true)
        expect(host.Save).toHaveBeenCalledWith(d)
        expect(host.Close).toHaveBeenCalledWith(d)
    })

    it("Don't Save → closes without saving", async () => {
        const host = makeHost([]); const d = doc('a', true)
        const g = guardWith(host, SavePromptResult.DontSave)
        expect(await g.TryCloseDocument(d as never)).toBe(true)
        expect(host.Save).not.toHaveBeenCalled()
        expect(host.Close).toHaveBeenCalledWith(d)
    })

    it('Cancel → neither saves nor closes', async () => {
        const host = makeHost([]); const d = doc('a', true)
        const g = guardWith(host, SavePromptResult.Cancel)
        expect(await g.TryCloseDocument(d as never)).toBe(false)
        expect(host.Close).not.toHaveBeenCalled()
    })

    it('a failed Save leaves the doc open (no close)', async () => {
        const host = makeHost([]); host.Save.mockRejectedValue(new Error('disk'))
        const d = doc('a', true)
        const g = guardWith(host, SavePromptResult.Save)
        expect(await g.TryCloseDocument(d as never)).toBe(false)
        expect(host.Close).not.toHaveBeenCalled()
    })
})

describe('DocumentCloseGuard.TryCloseAll', () => {
    it('closes every doc when none cancel', async () => {
        const a = doc('a', false), b = doc('b', false)
        const host = makeHost([a, b])
        const g = guardWith(host, SavePromptResult.DontSave)
        expect(await g.TryCloseAll()).toBe(true)
        expect(host.Close).toHaveBeenCalledTimes(2)
    })

    it('stops at the first Cancel', async () => {
        const a = doc('a', true), b = doc('b', true)
        const host = makeHost([a, b])
        const g = guardWith(host, SavePromptResult.Cancel)
        expect(await g.TryCloseAll()).toBe(false)
        expect(host.Close).not.toHaveBeenCalled()
    })
})
