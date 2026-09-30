import { describe, it, expect } from 'vitest'
import { Observable } from '@pragmatic-tech-ai/mural/runtime'
import { HierarchyExpansionBehavior } from '../hierarchy-expansion-behavior.js'

class FakeVm extends Observable
{
    private _expanded: boolean
    constructor(expanded: boolean) { super(); this._expanded = expanded }
    public get IsExpanded(): boolean { return this._expanded }
    public Set(v: boolean): void { const old = this._expanded; this._expanded = v; this.RaisePropertyChanged('IsExpanded', old, v) }
}

describe('HierarchyExpansionBehavior', () =>
{
    it('sets a container IsExpanded from its VM on wire, then follows VM changes', () =>
    {
        const b = new HierarchyExpansionBehavior()
        const vm = new FakeVm(true)
        const container = { IsExpanded: false }
        b.Wire(container, vm)
        expect(container.IsExpanded).toBe(true)     // data->view on realize
        vm.Set(false)
        expect(container.IsExpanded).toBe(false)     // follows later change
    })

    it('stops following after Unwire', () =>
    {
        const b = new HierarchyExpansionBehavior()
        const vm = new FakeVm(false)
        const container = { IsExpanded: false }
        b.Wire(container, vm)
        b.Unwire(container)
        vm.Set(true)
        expect(container.IsExpanded).toBe(false)     // no longer synced
    })

    it('re-wiring a container drops the old VM subscription', () =>
    {
        const b = new HierarchyExpansionBehavior()
        const first = new FakeVm(false)
        const second = new FakeVm(false)
        const container = { IsExpanded: false }
        b.Wire(container, first)
        b.Wire(container, second)     // recycled onto a new VM without an intervening clear
        first.Set(true)
        expect(container.IsExpanded).toBe(false)     // the stale first VM no longer drives it
        second.Set(true)
        expect(container.IsExpanded).toBe(true)      // the current VM does
    })
})
