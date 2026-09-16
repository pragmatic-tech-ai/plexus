import { describe, it, expect } from 'vitest'
import { collectScenarioFlow, type FlowEntity } from '../scenario-flow.js'

// Tiny FlowEntity builder: a map of member -> child entities.
function ent(id: string, rels: Record<string, FlowEntity[]> = {}): FlowEntity {
  return { id, refs: (m) => rels[m] ?? [] }
}
function step(src?: FlowEntity, dst?: FlowEntity): FlowEntity {
  return ent('step', { src: src ? [src] : [], dst: dst ? [dst] : [] })
}

describe('collectScenarioFlow', () => {
  const a = ent('a'), b = ent('b'), c = ent('c'), d = ent('d')

  it('collects the union of step src/dst as participants and deduped edges', () => {
    const seq1 = ent('s1', { steps: [step(a, b), step(b, c)] })
    const seq2 = ent('s2', { steps: [step(a, b), step(b, d)] })   // shares a->b
    const scenario = ent('sc', { sequences: [seq1, seq2] })
    const { participants, edges } = collectScenarioFlow(scenario)
    expect(new Set(participants)).toEqual(new Set(['a', 'b', 'c', 'd']))
    expect(edges).toContainEqual(['a', 'b'])
    expect(edges).toContainEqual(['b', 'c'])
    expect(edges).toContainEqual(['b', 'd'])
    expect(edges.filter(([s, t]) => s === 'a' && t === 'b')).toHaveLength(1)  // deduped
  })

  it('skips a step missing src or dst without throwing', () => {
    const seq = ent('s', { steps: [step(a, undefined), step(undefined, b), step(a, b)] })
    const scenario = ent('sc', { sequences: [seq] })
    const { participants, edges } = collectScenarioFlow(scenario)
    expect(edges).toEqual([['a', 'b']])
    expect(new Set(participants)).toEqual(new Set(['a', 'b']))
  })
})
