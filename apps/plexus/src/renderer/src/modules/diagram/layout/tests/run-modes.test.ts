import { test, expect } from 'vitest'

import { planForMode, RunMode } from '../run-modes.js'
import type { LayoutOutcome } from '../diagram-graph-adapter.js'

const outcome: LayoutOutcome = {
    setPositions: [{ id: 'a', left: 1, top: 2 }],
    droppedNodeIds: ['b'],
}

test('positions mode applies positions', () => {
    const plan = planForMode(RunMode.Positions, outcome)
    expect(plan.previewOnly).toBe(false)
    expect(plan.mutation.setPositions).toEqual(outcome.setPositions)
})

test('preview mode mutates nothing and flags previewOnly', () => {
    const plan = planForMode(RunMode.Preview, outcome)
    expect(plan.previewOnly).toBe(true)
    expect(plan.mutation.setPositions).toEqual([])
})
