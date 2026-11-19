import { describe, it, expect } from 'vitest'
import { GraphViewerDocument } from '../graph-viewer-document.js'

describe('GraphViewerDocument', () =>
{
    it('is an in-memory IDocument whose Save persists nothing and does not throw', () =>
    {
        const doc = new GraphViewerDocument()
        expect(typeof doc.Id).toBe('string')
        expect(typeof doc.Title).toBe('string')
        expect(typeof doc.IsDirty).toBe('boolean')
        expect(doc.Storage).toBeUndefined()

        expect(() => doc.Save()).not.toThrow()

        // No storage was attached, so nothing was persisted and the doc stays clean.
        expect(doc.Storage).toBeUndefined()
        expect(doc.IsDirty).toBe(false)
    })

    it('has a settable Title', () =>
    {
        const doc = new GraphViewerDocument()
        doc.Title = 'tenant graph'
        expect(doc.Title).toBe('tenant graph')
    })
})
