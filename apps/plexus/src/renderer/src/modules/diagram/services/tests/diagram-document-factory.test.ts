import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DiagramDocument } from '@pragmatic-tech-ai/mural/framework'

import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { DiagramDocumentFactory } from '../diagram-document-factory.js'

// Storage-facing behavior against a FakeStorage — no Electron, no disk.
function factory(): DiagramDocumentFactory
{
    return new DiagramDocumentFactory(new ServiceProvider())
}

test('newFile returns a project-relative .diagram path and writes an empty scene', async () => {
    const storage = new FakeStorage()
    const path = await factory().newFile(storage, 'city.diagram')
    expect(path).toBe('city.diagram')
    expect(await storage.Exists('city.diagram')).toBe(true)
})

test('newFile appends .diagram when the name omits it', async () => {
    const storage = new FakeStorage()
    const path = await factory().newFile(storage, 'city')
    expect(path).toBe('city.diagram')
})

test('openFile round-trips a diagram written by newFile, titled by basename', async () => {
    const storage = new FakeStorage()
    const f = factory()
    const path = await f.newFile(storage, 'city')
    const doc = await f.openFile(storage, path)
    expect(doc).toBeInstanceOf(DiagramDocument)
    expect(doc.Title).toBe('city.diagram')
})

test('relocateOpenFile retitles the open document to the new basename', async () => {
    const storage = new FakeStorage()
    const f = factory()
    const doc = await f.openFile(storage, await f.newFile(storage, 'city'))
    f.relocateOpenFile(doc, 'renamed.diagram')
    expect(doc.Title).toBe('renamed.diagram')
})
