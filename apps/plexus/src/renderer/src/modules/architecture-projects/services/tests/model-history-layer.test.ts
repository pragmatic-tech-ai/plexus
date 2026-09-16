import { test, expect } from 'vitest'
import { HistoryLayerId } from '@pragmatic-tech-ai/mural/framework'
import { ModelHistoryLayer } from '../model-history-layer.js'
import type { ArchModel } from '../arch-model.js'

test('capture/equals/restore/reconcile delegate to the model', () => {
    let restored: Map<string, string> | undefined
    let reconciled = 0
    const fake = {
        toTodlByFile: () => new Map([['a.todl', 'namespace m {}']]),
        restore: (m: Map<string, string>) => { restored = m },
        notifyChanged: () => { reconciled++ },
        save: async () => {},
    } as unknown as ArchModel

    const layer = new ModelHistoryLayer(fake)
    expect(layer.Id).toBe(HistoryLayerId.Model)

    const snap = layer.Capture()
    expect(layer.Equals(snap, layer.Capture())).toBe(true)
    expect(layer.Equals(snap, new Map([['a.todl', 'different']]))).toBe(false)
    expect(layer.Equals(snap, new Map())).toBe(false)

    layer.Restore(snap)
    expect(restored).toBeInstanceOf(Map)

    layer.Reconcile()
    expect(reconciled).toBe(1)
})
