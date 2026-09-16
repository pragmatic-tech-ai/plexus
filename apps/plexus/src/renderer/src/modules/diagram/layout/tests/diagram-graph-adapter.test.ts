import { test, expect } from 'vitest'
import { Graph } from '@pragmatic-tech-ai/fresco'

import { extract, computeOutcome, applySides, nodeSize } from '../diagram-graph-adapter.js'

const FALLBACK = { width: 80, height: 40 }

test('nodeSize prefers the authored Width/Height (VM nodes have no RenderSize)', () => {
    // A node VM: Width/Height set, RenderSize absent (Model, not Visual).
    expect(nodeSize({ Width: 72, Height: 56 }, FALLBACK)).toEqual({ width: 72, height: 56 })
})

test('nodeSize falls back to RenderSize when Width/Height are unset', () => {
    expect(nodeSize({ RenderSize: { Width: 120, Height: 44 } }, FALLBACK)).toEqual({ width: 120, height: 44 })
})

test('nodeSize prefers Width/Height over RenderSize when both present', () => {
    expect(nodeSize({ Width: 72, Height: 56, RenderSize: { Width: 999, Height: 999 } }, FALLBACK))
        .toEqual({ width: 72, height: 56 })
})

test('nodeSize returns the fallback when nothing is measurable', () => {
    expect(nodeSize({}, FALLBACK)).toEqual(FALLBACK)
    expect(nodeSize({ Width: 0, Height: 0 }, FALLBACK)).toEqual(FALLBACK)
})

test('extract synthesises a graph-local id for figures missing one WITHOUT mutating the node', () => {
    const a = { Id: undefined as string | undefined, Left: 0, Top: 0 }
    const b = { Id: 'kept', Left: 0, Top: 0 }
    const { graph, index } = extract([a, b], [])
    expect(a.Id).toBe(undefined)       // identity is NOT mutated — the id stays graph-local
    expect(index.get('n0')).toBe(a)    // …but the run still addresses it as 'n0'
    expect(index.get('kept')).toBe(b)
    expect(graph.nodes.map((n) => n.Id).sort()).toEqual(['kept', 'n0'])
})

test('extract builds edges from connector endpoint node references', () => {
    const a = { Id: 'a', Left: 0, Top: 0 }
    const b = { Id: 'b', Left: 0, Top: 0 }
    const conn = { Source: { Node: a }, Target: { Node: b } }
    const { graph } = extract([a, b], [conn])
    expect(graph.edges.map((e) => [e.From, e.To])).toEqual([['a', 'b']])
})

test('extract skips connectors with an unresolved endpoint', () => {
    const a = { Id: 'a', Left: 0, Top: 0 }
    const conn = { Source: { Node: a }, Target: { Node: undefined } }
    const { graph } = extract([a], [conn])
    expect(graph.edges.length).toBe(0)
})

test('extract skips connectors whose endpoint figure is not in the node set', () => {
    const a = { Id: 'a', Left: 0, Top: 0 }
    const stray = { Id: 'x', Left: 0, Top: 0 }   // not passed to extract
    const conn = { Source: { Node: a }, Target: { Node: stray } }
    const { graph } = extract([a], [conn])
    expect(graph.edges.length).toBe(0)
})

test('computeOutcome converts center points to top-left using node size', () => {
    const a = { Id: 'a', Left: 0, Top: 0 }
    const index = new Map([['a', a]])
    const transformed = new Graph(); transformed.AddNode('a')
    const positions = new Map([['a', { X: 100, Y: 50 }]])
    const outcome = computeOutcome(index, transformed, positions, () => ({ width: 40, height: 20 }))
    expect(outcome.setPositions).toEqual([{ id: 'a', left: 80, top: 40 }])
    expect(outcome.droppedNodeIds).toEqual([])
})

test('computeOutcome reports nodes dropped by transforms', () => {
    const a = { Id: 'a', Left: 0, Top: 0 }
    const b = { Id: 'b', Left: 0, Top: 0 }
    const index = new Map([['a', a], ['b', b]])
    const transformed = new Graph(); transformed.AddNode('a')   // b removed
    const positions = new Map([['a', { X: 10, Y: 10 }]])
    const outcome = computeOutcome(index, transformed, positions, () => ({ width: 0, height: 0 }))
    expect(outcome.droppedNodeIds).toEqual(['b'])
})

test('extract returns each resolved connector paired with its node ids', () => {
    const a = { Id: 'a', Left: 0, Top: 0 }
    const b = { Id: 'b', Left: 0, Top: 0 }
    const conn = { Source: { Node: a }, Target: { Node: b } }
    const { connectorEdges } = extract([a, b], [conn])
    expect(connectorEdges).toEqual([{ connector: conn, from: 'a', to: 'b' }])
})

test('extract omits unresolved connectors from connectorEdges', () => {
    const a = { Id: 'a', Left: 0, Top: 0 }
    const conn = { Source: { Node: a }, Target: { Node: undefined } }
    const { connectorEdges } = extract([a], [conn])
    expect(connectorEdges).toEqual([])
})

test('applySides writes source/target PortSide onto matching connectors', () => {
    const a = { Id: 'a', Left: 0, Top: 0 }
    const b = { Id: 'b', Left: 0, Top: 0 }
    const conn = { Source: { Node: a } as { Node: unknown; PortSide?: string },
                   Target: { Node: b } as { Node: unknown; PortSide?: string } }
    const { connectorEdges } = extract([a, b], [conn])
    const n = applySides(connectorEdges, new Map([['a|b', { source: 'S', target: 'N' }]]))
    expect(n).toBe(1)
    expect(conn.Source.PortSide).toBe('S')
    expect(conn.Target.PortSide).toBe('N')
})

test('applySides leaves connectors without a matching pair untouched', () => {
    const a = { Id: 'a', Left: 0, Top: 0 }
    const b = { Id: 'b', Left: 0, Top: 0 }
    const conn = { Source: { Node: a } as { Node: unknown; PortSide?: string },
                   Target: { Node: b } as { Node: unknown; PortSide?: string } }
    const { connectorEdges } = extract([a, b], [conn])
    const n = applySides(connectorEdges, new Map([['x|y', { source: 'E', target: 'W' }]]))
    expect(n).toBe(0)
    expect(conn.Source.PortSide).toBeUndefined()
    expect(conn.Target.PortSide).toBeUndefined()
})

test('computeOutcome skips positions for ids not in the index', () => {
    const a = { Id: 'a', Left: 0, Top: 0 }
    const index = new Map([['a', a]])
    const transformed = new Graph(); transformed.AddNode('a'); transformed.AddNode('dummy')
    const positions = new Map([['a', { X: 0, Y: 0 }], ['dummy', { X: 5, Y: 5 }]])
    const outcome = computeOutcome(index, transformed, positions, () => ({ width: 0, height: 0 }))
    expect(outcome.setPositions.map((p) => p.id)).toEqual(['a'])
})
