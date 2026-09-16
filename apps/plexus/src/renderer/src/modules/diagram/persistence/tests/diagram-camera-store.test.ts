import { test, expect } from 'vitest'
import { DiagramDocument } from '@pragmatic-tech-ai/mural/framework'
import { readCamera, writeCamera } from '../diagram-camera-store.js'

test('writeCamera then readCamera round-trips a camera through document metadata', () => {
    const doc = new DiagramDocument()
    expect(readCamera(doc)).toBeUndefined()
    writeCamera(doc, { zoom: 2, offsetX: 30, offsetY: 40 })
    expect(readCamera(doc)).toEqual({ zoom: 2, offsetX: 30, offsetY: 40 })
})

test('writeCamera preserves other metadata keys', () => {
    const doc = new DiagramDocument()
    doc.Metadata = { 'arch.viewpoints': ['logical'] }
    writeCamera(doc, { zoom: 1, offsetX: 0, offsetY: 0 })
    expect(doc.Metadata['arch.viewpoints']).toEqual(['logical'])
    expect(readCamera(doc)).toEqual({ zoom: 1, offsetX: 0, offsetY: 0 })
})

test('readCamera rejects a malformed stored value', () => {
    const doc = new DiagramDocument()
    doc.Metadata = { camera: { zoom: 'big', offsetX: 0, offsetY: 0 } }
    expect(readCamera(doc)).toBeUndefined()
})

test('camera survives a real serialize -> deserialize cycle', () => {
    const seed = new DiagramDocument()
    writeCamera(seed, { zoom: 1.5, offsetX: 12, offsetY: 34 })
    const payload = (seed as unknown as { _serialize(): unknown })._serialize()
    const opened = new DiagramDocument()
    ;(opened as unknown as { _deserialize(p: unknown): void })._deserialize(payload)
    expect(readCamera(opened)).toEqual({ zoom: 1.5, offsetX: 12, offsetY: 34 })
})
