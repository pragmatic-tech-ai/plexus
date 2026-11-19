import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { BoardDocument } from '@pragmatic-tech-ai/mural/framework'

import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { BoardDocumentFactory } from '../board-document-factory.js'

// Storage-facing behavior against a FakeStorage — no Electron, no disk.
function factory(): BoardDocumentFactory
{
    return new BoardDocumentFactory(new ServiceProvider())
}

test('newFile returns a project-relative .board path and writes an empty scene', async () => {
    const storage = new FakeStorage()
    const path = await factory().newFile(storage, 'city.board')
    expect(path).toBe('city.board')
    expect(await storage.Exists('city.board')).toBe(true)
})

test('newFile appends .board when the name omits it', async () => {
    const storage = new FakeStorage()
    const path = await factory().newFile(storage, 'city')
    expect(path).toBe('city.board')
})

test('openFile round-trips a board written by newFile, titled by basename', async () => {
    const storage = new FakeStorage()
    const f = factory()
    const path = await f.newFile(storage, 'city')
    const doc = await f.openFile(storage, path)
    expect(doc).toBeInstanceOf(BoardDocument)
    expect(doc.Title).toBe('city.board')
})

test('openFile opens a legacy .diagram file as a board (read back-compat)', async () => {
    const storage = new FakeStorage()
    // A board saved before the rename, still on disk with the .diagram extension.
    await storage.WriteText('legacy.diagram', JSON.stringify({ version: 3, nodes: [], visuals: {} }))
    const doc = await factory().openFile(storage, 'legacy.diagram')
    expect(doc).toBeInstanceOf(BoardDocument)
    expect(doc.Title).toBe('legacy.diagram')
})

test('relocateOpenFile retitles the open document to the new basename', async () => {
    const storage = new FakeStorage()
    const f = factory()
    const doc = await f.openFile(storage, await f.newFile(storage, 'city'))
    f.relocateOpenFile(doc, 'renamed.board')
    expect(doc.Title).toBe('renamed.board')
})
