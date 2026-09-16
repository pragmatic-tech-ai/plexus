import { test, expect } from 'vitest'
import { FlowDocument } from '@pragmatic-tech-ai/mural/basic'
import { WikiDocument } from '../wiki-document.js'

test('WikiDocument exposes Id (path), Title (file name), read-only IsDirty', () => {
    const doc = new WikiDocument('/mm/wiki/component.md', '# Component\n\nBody.')
    expect(doc.Id).toBe('/mm/wiki/component.md')
    expect(doc.Title).toBe('component.md')
    expect(doc.IsDirty).toBe(false)
    expect(doc.Document).toBeInstanceOf(FlowDocument)
})

test('Refresh rebuilds Document from new text (identity changes)', () => {
    const doc = new WikiDocument('/mm/wiki/component.md', '# One')
    const first = doc.Document
    doc.Refresh('# Two')
    expect(doc.Document).toBeInstanceOf(FlowDocument)
    expect(doc.Document).not.toBe(first)
    expect(doc.IsDirty).toBe(false)
})

test('Save is a no-op that does not throw', () => {
    const doc = new WikiDocument('/mm/wiki/component.md', '# Component')
    expect(() => doc.Save()).not.toThrow()
})
