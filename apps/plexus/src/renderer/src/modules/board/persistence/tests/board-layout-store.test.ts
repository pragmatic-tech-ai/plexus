import { test, expect } from 'vitest'
import { BoardDocument } from '@pragmatic-tech-ai/mural/framework'
import type { PipelineConfiguration } from '@pragmatic-tech-ai/fresco'
import {
    readLayoutConfig, writeLayoutConfig,
    boardPresetNames, getBoardPreset, saveBoardPreset, deleteBoardPreset,
} from '../board-layout-store.js'

function cfg(name: string): PipelineConfiguration
{
    return { name, transforms: ['MakeAcyclicTransform'], layout: { layerAssigner: { className: 'LongestPathLayerAssigner', params: {} } } }
}

// ── working config ──────────────────────────────────────────────────────────

test('writeLayoutConfig then readLayoutConfig round-trips a config through metadata', () => {
    const doc = new BoardDocument()
    expect(readLayoutConfig(doc)).toBeUndefined()
    writeLayoutConfig(doc, cfg('flow'))
    expect(readLayoutConfig(doc)).toEqual(cfg('flow'))
})

test('writeLayoutConfig clones — later mutation of the source does not alter the stored copy', () => {
    const doc = new BoardDocument()
    const c = cfg('flow')
    writeLayoutConfig(doc, c)
    ;(c.layout as Record<string, unknown>).layerAssigner = { className: 'Mutated', params: {} }
    expect(readLayoutConfig(doc)!.layout).toEqual({ layerAssigner: { className: 'LongestPathLayerAssigner', params: {} } })
})

test('writeLayoutConfig preserves other metadata keys', () => {
    const doc = new BoardDocument()
    doc.Metadata = { camera: { zoom: 1, offsetX: 0, offsetY: 0 } }
    writeLayoutConfig(doc, cfg('flow'))
    expect(doc.Metadata['camera']).toEqual({ zoom: 1, offsetX: 0, offsetY: 0 })
    expect(readLayoutConfig(doc)).toEqual(cfg('flow'))
})

test('readLayoutConfig rejects a malformed stored value', () => {
    const doc = new BoardDocument()
    doc.Metadata = { 'layout.config': { name: 5, transforms: 'nope', layout: null } }
    expect(readLayoutConfig(doc)).toBeUndefined()
})

test('the working config survives a real serialize -> deserialize cycle', () => {
    const seed = new BoardDocument()
    writeLayoutConfig(seed, cfg('flow'))
    const payload = (seed as unknown as { _serialize(): unknown })._serialize()
    const opened = new BoardDocument()
    ;(opened as unknown as { _deserialize(p: unknown): void })._deserialize(payload)
    expect(readLayoutConfig(opened)).toEqual(cfg('flow'))
})

// ── board-scoped presets ────────────────────────────────────────────────────

test('saveBoardPreset / getBoardPreset / boardPresetNames round-trip', () => {
    const doc = new BoardDocument()
    expect(boardPresetNames(doc)).toEqual([])
    saveBoardPreset(doc, 'a', cfg('a'))
    saveBoardPreset(doc, 'b', cfg('b'))
    expect(boardPresetNames(doc)).toEqual(['a', 'b'])
    expect(getBoardPreset(doc, 'a')).toEqual(cfg('a'))
    expect(getBoardPreset(doc, 'missing')).toBeUndefined()
})

test('deleteBoardPreset removes one and keeps the rest', () => {
    const doc = new BoardDocument()
    saveBoardPreset(doc, 'a', cfg('a'))
    saveBoardPreset(doc, 'b', cfg('b'))
    deleteBoardPreset(doc, 'a')
    expect(boardPresetNames(doc)).toEqual(['b'])
    deleteBoardPreset(doc, 'missing')   // tolerated
    expect(boardPresetNames(doc)).toEqual(['b'])
})

test('board presets and working config coexist and both survive serialize -> deserialize', () => {
    const seed = new BoardDocument()
    writeLayoutConfig(seed, cfg('working'))
    saveBoardPreset(seed, 'saved', cfg('saved'))
    const payload = (seed as unknown as { _serialize(): unknown })._serialize()
    const opened = new BoardDocument()
    ;(opened as unknown as { _deserialize(p: unknown): void })._deserialize(payload)
    expect(readLayoutConfig(opened)).toEqual(cfg('working'))
    expect(getBoardPreset(opened, 'saved')).toEqual(cfg('saved'))
})
