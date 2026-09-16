import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { DiagramDocument } from '@pragmatic-tech-ai/mural/framework'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { readViewpoints, writeViewpoints, writeViewpointsToFile, ARCH_VIEWPOINTS_KEY } from '../arch-diagram-viewpoints-store.js'

// A minimal in-memory IStorage for the file-write path.
function memStorage(seed: Record<string, string> = {}): IStorage & { files: Record<string, string> }
{
    const files = { ...seed }
    return {
        files,
        ReadText: async (p: string) => { if (!(p in files)) throw new Error('ENOENT'); return files[p]! },
        WriteText: async (p: string, c: string) => { files[p] = c },
        Exists: async (p: string) => p in files,
        Delete: async (p: string) => { delete files[p] },
    } as unknown as IStorage & { files: Record<string, string> }
}

// The diagram's governing viewpoints are serialized WITH the diagram, in the
// document's opaque metadata under ARCH_VIEWPOINTS_KEY, so they restore on open.
describe('arch diagram viewpoints store', () => {

    test('write then read returns the same ids via document metadata', () => {
        const doc = new DiagramDocument()
        writeViewpoints(doc, ['deployment', 'logical'])
        assert.deepEqual(readViewpoints(doc), ['deployment', 'logical'])
        assert.deepEqual(doc.Metadata[ARCH_VIEWPOINTS_KEY], ['deployment', 'logical'])
    })

    test('read returns undefined when the document has no viewpoints', () => {
        assert.equal(readViewpoints(new DiagramDocument()), undefined)
    })

    test('writeViewpoints preserves other metadata keys', () => {
        const doc = new DiagramDocument()
        doc.Metadata = { other: 1 }
        writeViewpoints(doc, ['a'])
        assert.equal(doc.Metadata.other, 1)
        assert.deepEqual(readViewpoints(doc), ['a'])
    })

    test('read ignores a non-string-array metadata value', () => {
        const doc = new DiagramDocument()
        doc.Metadata = { [ARCH_VIEWPOINTS_KEY]: 'not-an-array' }
        assert.equal(readViewpoints(doc), undefined)
    })

    test('writeViewpointsToFile injects metadata while preserving the scene', async () => {
        const storage = memStorage({ 'd.diagram': JSON.stringify({ nodes: [{ id: 'n1' }], nextId: 2 }) })
        await writeViewpointsToFile(storage, 'd.diagram', ['deployment'])
        const written = JSON.parse(storage.files['d.diagram']!)
        assert.deepEqual(written.nodes, [{ id: 'n1' }])
        assert.equal(written.nextId, 2)
        assert.deepEqual(written.metadata[ARCH_VIEWPOINTS_KEY], ['deployment'])
    })

    test('writeViewpointsToFile round-trips through a real DiagramDocument load', async () => {
        // Emulate the open path: the file the participant wrote is deserialized
        // by the document, and readViewpoints sees the viewpoints.
        const storage = memStorage()
        const seed = new DiagramDocument()
        await storage.WriteText('d.diagram', JSON.stringify((seed as unknown as { _serialize(): unknown })._serialize()))
        await writeViewpointsToFile(storage, 'd.diagram', ['logical', 'deployment'])
        const opened = new DiagramDocument()
        ;(opened as unknown as { _deserialize(p: unknown): void })._deserialize(JSON.parse(storage.files['d.diagram']!))
        assert.deepEqual(readViewpoints(opened), ['logical', 'deployment'])
    })
})
