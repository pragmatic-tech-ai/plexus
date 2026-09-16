import { describe, it, expect } from 'vitest'
import { scenarioStepPairs, type FlowEntity } from '../scenario-flow.js'

function ent(id: string, rels: Record<string, FlowEntity[]> = {}): FlowEntity {
  return { id, refs: (m) => rels[m] ?? [] }
}
function step(s: FlowEntity, d: FlowEntity): FlowEntity { return ent('step', { src: [s], dst: [d] }) }
const a = ent('a'), b = ent('b'), c = ent('c')

describe('scenarioStepPairs', () => {
  it('returns step pairs whose both endpoints are placed', () => {
    const sc = ent('sc', { sequences: [ent('s', { steps: [step(a, b), step(b, c)] })] })
    expect(scenarioStepPairs([sc], new Set(['a', 'b', 'c']))).toEqual([['a', 'b'], ['b', 'c']])
  })

  it('drops a pair whose endpoint is not placed', () => {
    const sc = ent('sc', { sequences: [ent('s', { steps: [step(a, b), step(b, c)] })] })
    expect(scenarioStepPairs([sc], new Set(['a', 'b']))).toEqual([['a', 'b']])   // c not placed
  })

  it('dedupes the same pair across scenarios', () => {
    const sc1 = ent('sc1', { sequences: [ent('s', { steps: [step(a, b)] })] })
    const sc2 = ent('sc2', { sequences: [ent('s', { steps: [step(a, b)] })] })
    expect(scenarioStepPairs([sc1, sc2], new Set(['a', 'b']))).toEqual([['a', 'b']])
  })
})
