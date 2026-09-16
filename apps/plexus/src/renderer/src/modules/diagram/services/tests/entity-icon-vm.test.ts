import { describe, it, expect } from 'vitest'

import type { TodlPresentationRegistry } from '../todl-presentation-registry.js'
import { EntityIconVM } from '../entity-icon-vm.js'

// A registry stub exposing iconKeyFor (EntityIconVM's surface). No onChanged —
// the VM never subscribes; reactivity is owner-driven via refresh().
function fakeRegistry(index: Map<string, string>) {
    return {
        iconKeyFor: (k: string) => index.get(k),
    }
}

const reg = (index: Map<string, string>) =>
    fakeRegistry(index) as unknown as TodlPresentationRegistry

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

    it('refresh() recomputes + notifies IconKey when the registry index changes', () => {
        const index = new Map<string, string>()
        const vm = new EntityIconVM(reg(index), 'a.b')
        expect(vm.IconKey).toBe('')
        let fired = 0
        vm.PropertyChanged('IconKey').subscribe(() => fired++)
        index.set('a.b', 'now')
        vm.refresh()
        expect(vm.IconKey).toBe('now')
        expect(fired).toBeGreaterThanOrEqual(1)
    })

    it('refresh() with no change does not notify', () => {
        const vm = new EntityIconVM(reg(new Map([['a.b', 'icon-ab']])), 'a.b')
        let fired = 0
        vm.PropertyChanged('IconKey').subscribe(() => fired++)
        vm.refresh()
        expect(fired).toBe(0)
    })
})
