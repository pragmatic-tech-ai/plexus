import { describe, it, expect, vi } from 'vitest'
import { saveDirtyDocuments } from '../autosave-service.js'

function doc(id: string, dirty: boolean) {
    return { Id: id, Title: id, IsDirty: dirty, Save: vi.fn() }
}
function hostWith(docs: ReturnType<typeof doc>[]) {
    return { OpenDocuments: { ToArray: () => docs }, Save: vi.fn((d) => d.Save()) }
}

describe('saveDirtyDocuments', () => {
    it('saves only dirty documents', () => {
        const a = doc('a', true), b = doc('b', false), c = doc('c', true)
        const host = hostWith([a, b, c])
        saveDirtyDocuments(host as never)
        expect(host.Save).toHaveBeenCalledTimes(2)
        expect(a.Save).toHaveBeenCalled()
        expect(b.Save).not.toHaveBeenCalled()
        expect(c.Save).toHaveBeenCalled()
    })

    it('continues past a failing Save (transient write error)', () => {
        const a = doc('a', true); a.Save.mockImplementation(() => { throw new Error('disk') })
        const c = doc('c', true)
        const host = { OpenDocuments: { ToArray: () => [a, c] }, Save: vi.fn((d) => d.Save()) }
        expect(() => saveDirtyDocuments(host as never)).not.toThrow()
        expect(c.Save).toHaveBeenCalled()
    })
})
