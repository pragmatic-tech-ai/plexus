import { describe, it, expect } from 'vitest'

import type { TodlPresentationRegistry } from '../todl-presentation-registry.js'
import { EntityIconVM } from '../entity-icon-vm.js'

// A registry stub exposing iconKeyFor + onChanged (EntityIconVM's surface).
function fakeRegistry(index: Map<string, string>) {
    const listeners = new Set<(key: string) => void>()
    return {
        iconKeyFor: (k: string) => index.get(k),
        onChanged: (cb: (key: string) => void) => { listeners.add(cb); return () => listeners.delete(cb) },
        fire(key: string) { for (const l of listeners) l(key) },
        listenerCount() { return listeners.size },
    }
}

const reg = (index: Map<string, string>) =>
    fakeRegistry(index) as unknown as TodlPresentationRegistry & { fire(k: string): void; listenerCount(): number }

describe('EntityIconVM', () => {
    it('resolves the icon key directly', () => {
        expect(new EntityIconVM(reg(new Map([['a.b', 'icon-ab']])), 'a.b').IconKey).toBe('icon-ab')
    })

    it('falls back to the mm: keyspace for a bare term id (arch canvas nodes)', () => {
        expect(new EntityIconVM(reg(new Map([['mm:x', 'icon-x']])), 'x').IconKey).toBe('icon-x')
    })

    it('unknown key → empty (default glyph)', () => {
        expect(new EntityIconVM(reg(new Map()), 'nope').IconKey).toBe('')
    })

    it('re-emits IconKey when the registry index changes', () => {
        const index = new Map<string, string>()
        const r = reg(index)
        const vm = new EntityIconVM(r, 'a.b')
        expect(vm.IconKey).toBe('')
        let fired = 0
        vm.PropertyChanged('IconKey').subscribe(() => fired++)
        index.set('a.b', 'now')
        r.fire('a.b')
        expect(vm.IconKey).toBe('now')
        expect(fired).toBeGreaterThanOrEqual(1)
    })

    it('dispose unsubscribes from the registry', () => {
        const index = new Map<string, string>()
        const r = reg(index)
        const vm = new EntityIconVM(r, 'a.b')
        expect(r.listenerCount()).toBe(1)
        vm.dispose()
        expect(r.listenerCount()).toBe(0)
    })
})
