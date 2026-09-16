import { test, expect } from 'vitest'
import { DiagramDocument } from '@pragmatic-tech-ai/mural/framework'
import type { PipelineConfiguration } from '@pragmatic-tech-ai/fresco'
import {
    readLayoutConfig, writeLayoutConfig,
    diagramPresetNames, getDiagramPreset, saveDiagramPreset, deleteDiagramPreset,
} from '../diagram-layout-store.js'

function cfg(name: string): PipelineConfiguration {
    return { name, transforms: ['MakeAcyclicTransform'], layout: { layerAssigner: { className: 'LongestPathLayerAssigner', params: {} } } }
}

// ── working config ──────────────────────────────────────────────────────────

test('writeLayoutConfig then readLayoutConfig round-trips a config through metadata', () => {
    const doc = new DiagramDocument()
    expect(readLayoutConfig(doc)).toBeUndefined()
    writeLayoutConfig(doc, cfg('flow'))
    expect(readLayoutConfig(doc)).toEqual(cfg('flow'))
})

test('writeLayoutConfig clones — later mutation of the source does not alter the stored copy', () => {
    const doc = new DiagramDocument()
    const c = cfg('flow')
    writeLayoutConfig(doc, c)
    ;(c.layout as Record<string, unknown>).layerAssigner = { className: 'Mutated', params: {} }
    expect(readLayoutConfig(doc)!.layout).toEqual({ layerAssigner: { className: 'LongestPathLayerAssigner', params: {} } })
})

test('writeLayoutConfig preserves other metadata keys', () => {
    const doc = new DiagramDocument()
    doc.Metadata = { camera: { zoom: 1, offsetX: 0, offsetY: 0 } }
    writeLayoutConfig(doc, cfg('flow'))
    expect(doc.Metadata['camera']).toEqual({ zoom: 1, offsetX: 0, offsetY: 0 })
    expect(readLayoutConfig(doc)).toEqual(cfg('flow'))
})

test('readLayoutConfig rejects a malformed stored value', () => {
    const doc = new DiagramDocument()
    doc.Metadata = { 'layout.config': { name: 5, transforms: 'nope', layout: null } }
    expect(readLayoutConfig(doc)).toBeUndefined()
})

test('the working config survives a real serialize -> deserialize cycle', () => {
    const seed = new DiagramDocument()
    writeLayoutConfig(seed, cfg('flow'))
    const payload = (seed as unknown as { _serialize(): unknown })._serialize()
    const opened = new DiagramDocument()
    ;(opened as unknown as { _deserialize(p: unknown): void })._deserialize(payload)
    expect(readLayoutConfig(opened)).toEqual(cfg('flow'))
})

// ── diagram-scoped presets ────────────────────────────────────────────────────

test('saveDiagramPreset / getDiagramPreset / diagramPresetNames round-trip', () => {
    const doc = new DiagramDocument()
    expect(diagramPresetNames(doc)).toEqual([])
    saveDiagramPreset(doc, 'a', cfg('a'))
    saveDiagramPreset(doc, 'b', cfg('b'))
    expect(diagramPresetNames(doc)).toEqual(['a', 'b'])
    expect(getDiagramPreset(doc, 'a')).toEqual(cfg('a'))
    expect(getDiagramPreset(doc, 'missing')).toBeUndefined()
})

test('deleteDiagramPreset removes one and keeps the rest', () => {
    const doc = new DiagramDocument()
    saveDiagramPreset(doc, 'a', cfg('a'))
    saveDiagramPreset(doc, 'b', cfg('b'))
    deleteDiagramPreset(doc, 'a')
    expect(diagramPresetNames(doc)).toEqual(['b'])
    deleteDiagramPreset(doc, 'missing')   // tolerated
    expect(diagramPresetNames(doc)).toEqual(['b'])
})

test('diagram presets and working config coexist and both survive serialize -> deserialize', () => {
    const seed = new DiagramDocument()
    writeLayoutConfig(seed, cfg('working'))
    saveDiagramPreset(seed, 'saved', cfg('saved'))
    const payload = (seed as unknown as { _serialize(): unknown })._serialize()
    const opened = new DiagramDocument()
    ;(opened as unknown as { _deserialize(p: unknown): void })._deserialize(payload)
    expect(readLayoutConfig(opened)).toEqual(cfg('working'))
    expect(getDiagramPreset(opened, 'saved')).toEqual(cfg('saved'))
})
