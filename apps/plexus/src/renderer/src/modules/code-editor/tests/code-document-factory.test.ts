import { test, expect } from 'vitest'

import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { CodeDocument } from '../code-document.js'
import { CodeDocumentFactory } from '../code-document-factory.js'

function factory(): CodeDocumentFactory { return new CodeDocumentFactory() }

test('openFile opens a .mu file as a CodeDocument keyed by its path, language "mural"', async () => {
    const storage = new FakeStorage('fake://proj')
    await storage.WriteText('presentation.generated.mu', 'resources X { }')

    const doc = await factory().openFile(storage, 'presentation.generated.mu') as CodeDocument

    expect(doc).toBeInstanceOf(CodeDocument)
    expect(doc.Id).toBe('presentation.generated.mu')
    expect(doc.Language).toBe('mural')
})

test('newFile creates an empty file with the .mural extension and returns its path', async () => {
    const storage = new FakeStorage('fake://proj')

    const path = await factory().newFile(storage, 'visual')

    expect(path).toBe('visual.mural')
    expect(await storage.Exists('visual.mural')).toBe(true)
    expect(await storage.ReadText('visual.mural')).toBe('')
})

test('newFile keeps an explicit .mu extension', async () => {
    const storage = new FakeStorage('fake://proj')
    const path = await factory().newFile(storage, 'theme.mu')
    expect(path).toBe('theme.mu')
})

test('saveFile writes the document Content back to storage', async () => {
    const storage = new FakeStorage('fake://proj')
    await storage.WriteText('a.mu', 'old')
    const f = factory()
    const doc = await f.openFile(storage, 'a.mu') as CodeDocument
    doc.Content = 'new content'

    await f.saveFile(doc)

    expect(await storage.ReadText('a.mu')).toBe('new content')
})

test('relocateOpenFile re-points the document Id + language to the new path', async () => {
    const storage = new FakeStorage('fake://proj')
    await storage.WriteText('a.mu', 'x')
    const f = factory()
    const doc = await f.openFile(storage, 'a.mu') as CodeDocument

    f.relocateOpenFile(doc, 'sub/b.mural')

    expect(doc.Id).toBe('sub/b.mural')
    expect(doc.Language).toBe('mural')
})
