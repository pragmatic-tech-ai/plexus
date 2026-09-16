import { describe, it, expect } from 'vitest'
import { TaskOutputDocument } from '../task-output-document.js'
import { TaskHandle } from '../task-handle.js'

describe('TaskOutputDocument', () => {
    it('derives a stable Id and Title from its handle and is never dirty', () => {
        const h = new TaskHandle({ id: 't9', title: 'Publish Billing', kind: 'publish' })
        const doc = new TaskOutputDocument(h)
        expect(doc.Id).toBe('task-output:t9')
        expect(doc.Title).toContain('Publish Billing')
        expect(doc.IsDirty).toBe(false)
        expect(doc.Handle).toBe(h)
    })
    it('Save() is a no-op that resolves', async () => {
        const doc = new TaskOutputDocument(new TaskHandle({ id: 't', title: 'x', kind: 'inline' }))
        await expect(Promise.resolve(doc.Save())).resolves.toBeUndefined()
    })
})
