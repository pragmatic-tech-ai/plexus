import { describe, it, expect } from 'vitest'
import { layoutColumns, planScenarioDrop, type ContainmentLayout, type FlowEntity } from '../scenario-flow.js'

function ent(id: string, rels: Record<string, FlowEntity[]> = {}): FlowEntity {
  return { id, refs: (m) => rels[m] ?? [] }
}
function step(src: FlowEntity, dst: FlowEntity): FlowEntity {
  return ent('step', { src: [src], dst: [dst] })
}

describe('layoutColumns', () => {
  it('assigns longest-path columns for a diamond', () => {
    const col = layoutColumns(['a', 'b', 'c', 'd'], [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd']])
    expect(col.get('a')).toBe(0)
    expect(col.get('b')).toBe(1)
    expect(col.get('c')).toBe(1)
    expect(col.get('d')).toBe(2)
  })

  it('breaks cycles so columns stay finite', () => {
    const col = layoutColumns(['a', 'b', 'c'], [['a', 'b'], ['b', 'c'], ['c', 'a']])
    expect(col.get('a')).toBe(0)
    expect(col.get('b')).toBe(1)
    expect(col.get('c')).toBe(2)   // back-edge c->a dropped from layering
  })
})

describe('planScenarioDrop', () => {
  const a = ent('a'), b = ent('b'), c = ent('c')
  const scenario = ent('sc', { sequences: [ent('s', { steps: [step(a, b), step(b, c)] })] })

  it('positions new nodes on the flow grid from the drop origin', () => {
    const plan = planScenarioDrop(scenario, new Set(), { x: 100, y: 50 }, { colDx: 200, rowDy: 120 })
    const byId = new Map(plan.nodes.map((n) => [n.id, n]))
    expect(byId.get('a')).toMatchObject({ left: 100, top: 50, isNew: true })   // col 0, row 0
    expect(byId.get('b')).toMatchObject({ left: 300, isNew: true })            // col 1
    expect(byId.get('c')).toMatchObject({ left: 500, isNew: true })            // col 2
    expect(plan.edges).toEqual([['a', 'b'], ['b', 'c']])
  })

  it('marks already-placed participants as not new', () => {
    const plan = planScenarioDrop(scenario, new Set(['a']), { x: 0, y: 0 })
    expect(plan.nodes.find((n) => n.id === 'a')!.isNew).toBe(false)
    expect(plan.nodes.find((n) => n.id === 'b')!.isNew).toBe(true)
  })

  describe('with a containment layout', () => {
    // a nests in placed container 'azure' at (1000,500); b/c have no container.
    const layout: ContainmentLayout = {
      containerOf: (id) => (id === 'a' ? 'azure' : undefined),
      containerAt: (cid) => (cid === 'azure' ? { left: 1000, top: 500 } : undefined),
      existingChildren: () => 0,
    }

    it('places a contained participant inside its container, free ones on the flow', () => {
      const plan = planScenarioDrop(scenario, new Set(), { x: 100, y: 50 }, { colDx: 200, rowDy: 120 }, layout)
      const byId = new Map(plan.nodes.map((n) => [n.id, n]))
      // a → first slot inside azure: container origin + inset (8, 32).
      expect(byId.get('a')).toMatchObject({ left: 1008, top: 532, isNew: true })
      // b/c stay in the free flow; with 'a' removed, b is a source → column 0.
      expect(byId.get('b')).toMatchObject({ left: 100, isNew: true })
      expect(byId.get('c')).toMatchObject({ left: 300, isNew: true })
      // Step edges are unchanged — the flow arrows still project.
      expect(plan.edges).toEqual([['a', 'b'], ['b', 'c']])
    })

    it('offsets new members past the container`s existing children', () => {
      const withTwo: ContainmentLayout = { ...layout, existingChildren: () => 2 }
      const plan = planScenarioDrop(scenario, new Set(), { x: 0, y: 0 }, undefined, withTwo)
      // slot 2 → column 2, row 0: origin + inset(8,32) + (2*96, 0).
      expect(plan.nodes.find((n) => n.id === 'a')).toMatchObject({ left: 1000 + 8 + 192, top: 500 + 32 })
    })

    it('wraps to a new row after three members in a container', () => {
      // three participants all nesting in the same container.
      const p = ['p0', 'p1', 'p2', 'p3'].map((id) => ent(id))
      const seq = ent('s', { steps: [step(p[0], p[1]), step(p[1], p[2]), step(p[2], p[3])] })
      const sc = ent('sc', { sequences: [seq] })
      const allIn: ContainmentLayout = {
        containerOf: () => 'box',
        containerAt: () => ({ left: 0, top: 0 }),
        existingChildren: () => 0,
      }
      const plan = planScenarioDrop(sc, new Set(), { x: 0, y: 0 }, undefined, allIn)
      const byId = new Map(plan.nodes.map((n) => [n.id, n]))
      expect(byId.get('p0')).toMatchObject({ left: 8, top: 32 })            // slot 0 → (0,0)
      expect(byId.get('p2')).toMatchObject({ left: 8 + 2 * 96, top: 32 })   // slot 2 → col 2
      expect(byId.get('p3')).toMatchObject({ left: 8, top: 32 + 76 })       // slot 3 → wraps to row 1
    })
  })
})
