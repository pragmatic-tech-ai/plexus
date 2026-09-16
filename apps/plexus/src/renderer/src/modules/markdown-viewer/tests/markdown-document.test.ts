import { describe, test, expect } from 'vitest'
import { FlowDocument, Paragraph } from '@pragmatic-tech-ai/mural/basic'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { MarkdownDocument } from '../markdown-document.js'
import { MarkdownDocumentFactory } from '../markdown-document-factory.js'

// In-memory storage with the text ops the factory uses.
function memStorage(files: Record<string, string> = {}): IStorage {
    return {
        Root: '/mem',
        ReadText: async (p: string) => {
            if (!(p in files)) throw new Error(`missing ${p}`)
            return files[p]!
        },
        WriteText: async (p: string, c: string) => { files[p] = c },
        ReadBytes: async () => { throw new Error('no bytes') },
    } as unknown as IStorage
}

describe('MarkdownDocument', () => {
    test('renders the markdown into a FlowDocument and titles from the path', () => {
        const doc = new MarkdownDocument('docs/readme.md', '# Hello\n\nbody')
        expect(doc.Id).toBe('docs/readme.md')
        expect(doc.Title).toBe('readme.md')
        expect(doc.Document).toBeInstanceOf(FlowDocument)
        expect(doc.Document.Blocks.ToArray()[0]).toBeInstanceOf(Paragraph)   // heading
    })

    test('is read-only: never dirty, save is a no-op', () => {
        const doc = new MarkdownDocument('a.md', 'text')
        expect(doc.IsDirty).toBe(false)
        expect(() => doc.Save()).not.toThrow()
    })

    test('Refresh re-renders from new text', () => {
        const doc = new MarkdownDocument('a.md', 'one')
        const before = doc.Document
        doc.Refresh('# two')
        expect(doc.Document).not.toBe(before)
        expect(doc.Document.Blocks.ToArray().length).toBeGreaterThan(0)
    })
})

describe('MarkdownDocumentFactory', () => {
    test('openFile reads the file and builds a MarkdownDocument', async () => {
        const storage = memStorage({ 'docs/readme.md': '# Title\n\nprose' })
        const f = new MarkdownDocumentFactory()
        const doc = await f.openFile(storage, 'docs/readme.md') as MarkdownDocument
        expect(doc).toBeInstanceOf(MarkdownDocument)
        expect(doc.Title).toBe('readme.md')
        expect(doc.Document.Blocks.ToArray().length).toBeGreaterThan(0)
    })

    test('newFile appends .md when the name lacks a markdown extension', async () => {
        const files: Record<string, string> = {}
        const storage = memStorage(files)
        const f = new MarkdownDocumentFactory()
        expect(await f.newFile(storage, 'notes')).toBe('notes.md')
        expect(files['notes.md']).toBe('')
    })

    test('newFile keeps an existing markdown extension', async () => {
        const f = new MarkdownDocumentFactory()
        expect(await f.newFile(memStorage(), 'guide.markdown')).toBe('guide.markdown')
        expect(await f.newFile(memStorage(), 'guide.md')).toBe('guide.md')
    })

    test('saveFile is a no-op for the read-only viewer', async () => {
        const f = new MarkdownDocumentFactory()
        const doc = new MarkdownDocument('a.md', 'x')
        await expect(f.saveFile(doc)).resolves.toBeUndefined()
    })
})
