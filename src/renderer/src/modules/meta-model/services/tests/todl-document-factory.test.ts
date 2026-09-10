import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { CodeDocument } from '../../../code-editor/code-document.js'
import { TodlDocumentFactory } from '../todl-document-factory.js'

// The validator is optional (resolved with get, not getRequired) — absent here.
function factory(): TodlDocumentFactory
{
    return new TodlDocumentFactory(new ServiceProvider())
}

test('newFile creates a project-relative .todl and openFile returns a todl CodeDocument', async () => {
    const storage = new FakeStorage()
    const f = factory()
    const path = await f.newFile(storage, 'core')
    expect(path).toBe('core.todl')
    expect(await storage.Exists('core.todl')).toBe(true)

    const doc = await f.openFile(storage, path)
    expect(doc).toBeInstanceOf(CodeDocument)
    expect((doc as CodeDocument).Language).toBe('todl')
    expect(doc.Title).toBe('core.todl')
})

test('newFile keeps an explicit .todl extension', async () => {
    const storage = new FakeStorage()
    const path = await factory().newFile(storage, 'core.todl')
    expect(path).toBe('core.todl')
})

test('saveFile writes the document content back to storage', async () => {
    const storage = new FakeStorage()
    const f = factory()
    const path = await f.newFile(storage, 'core')
    const doc = (await f.openFile(storage, path)) as CodeDocument
    doc.Content = 'namespace n {}'
    await f.saveFile(doc)
    expect(await storage.ReadText('core.todl')).toBe('namespace n {}')
})
