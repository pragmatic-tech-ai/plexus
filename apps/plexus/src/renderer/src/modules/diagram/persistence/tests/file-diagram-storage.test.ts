import { test, expect } from 'vitest'

import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { FileDiagramStorage } from '../file-diagram-storage.js'

// FileDiagramStorage bridges mural's synchronous DiagramStorage seam onto an
// async IStorage: reads serve an in-memory snapshot, writes fire in the
// background and are awaited via WhenWritten(). These verify that bridge against
// a FakeStorage (no Electron, no disk).

test('GetItem serves the seed snapshot before any write', () => {
    const store = new FileDiagramStorage('a.diagram', new FakeStorage(), '{"seed":true}')
    expect(store.GetItem('ignored-key')).toBe('{"seed":true}')
})

test('GetItem is null when opened with no seed', () => {
    const store = new FileDiagramStorage('a.diagram', new FakeStorage(), null)
    expect(store.GetItem('ignored-key')).toBeNull()
})

test('SetItem updates the snapshot synchronously and persists to storage', async () => {
    const storage = new FakeStorage()
    const store = new FileDiagramStorage('diagrams/a.diagram', storage, null)

    store.SetItem('ignored-key', '{"nodes":[]}')
    expect(store.GetItem('ignored-key')).toBe('{"nodes":[]}')   // visible immediately

    await store.WhenWritten()
    expect(await storage.ReadText('diagrams/a.diagram')).toBe('{"nodes":[]}')
})

test('the storage key is ignored — a file is one slot', () => {
    const store = new FileDiagramStorage('a.diagram', new FakeStorage(), 'v')
    expect(store.GetItem('k1')).toBe('v')
    expect(store.GetItem('k2')).toBe('v')
})
