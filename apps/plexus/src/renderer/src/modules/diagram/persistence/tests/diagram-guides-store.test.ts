import { test, expect } from 'vitest'
import { DiagramDocument } from '@pragmatic-tech-ai/mural/framework'
import { AlignmentAxis, EdgeKind } from '@pragmatic-tech-ai/mural/runtime'
import { readGuides, writeGuides } from '../diagram-guides-store.js'

test('writeGuides then readGuides round-trips guides (incl. glue) through metadata', () => {
    const doc = new DiagramDocument()
    expect(readGuides(doc)).toBeUndefined()
    const guides = [{ axis: AlignmentAxis.X, position: 120, glued: [{ nodeId: 'n3', edge: EdgeKind.Min }] }]
    writeGuides(doc, { guides })
    expect(readGuides(doc)).toEqual({ guides })
})

test('writeGuides preserves other metadata keys', () => {
    const doc = new DiagramDocument()
    doc.Metadata = { camera: { zoom: 1, offsetX: 0, offsetY: 0 } }
    writeGuides(doc, { guides: [] })
    expect(doc.Metadata.camera).toEqual({ zoom: 1, offsetX: 0, offsetY: 0 })
    expect(readGuides(doc)).toEqual({ guides: [] })
})

test('readGuides rejects a malformed stored value', () => {
    const doc = new DiagramDocument()
    doc.Metadata = { guides: 42 }
    expect(readGuides(doc)).toBeUndefined()
})
