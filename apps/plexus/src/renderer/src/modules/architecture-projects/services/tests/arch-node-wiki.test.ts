import { test, expect } from 'vitest'
import { ArchNodeVM } from '../arch-node-vm.js'

test('ArchNodeVM exposes settable Concept and HasWiki', () => {
    const n = new ArchNodeVM()
    expect(n.Concept).toBe('')
    expect(n.HasWiki).toBe(false)
    n.Concept = 'service'
    n.HasWiki = true
    expect(n.Concept).toBe('service')
    expect(n.HasWiki).toBe(true)
})
