import { describe, it, expect } from 'vitest'
import { ArchModelGateway } from '../arch-model-gateway.js'
import { PatchOpKind } from '../../../../../../shared/model-patch-api.js'

class FakeModel {
    calls: string[] = []
    create(c: string, id: string): void { this.calls.push(`create ${c} ${id}`) }
    setField(id: string, f: string, v: string): void { this.calls.push(`set ${id}.${f}=${v}`) }
    addRef(a: string, m: string, b: string): void { this.calls.push(`addRef ${a}.${m}->${b}`) }
    removeRef(a: string, m: string, b: string): void { this.calls.push(`removeRef ${a}.${m}->${b}`) }
    remove(id: string): void { this.calls.push(`remove ${id}`) }
}

describe('ArchModelGateway.applyOpTo', () => {
    it('dispatches each op kind to the matching mutator', () => {
        const m = new FakeModel()
        ArchModelGateway.applyOpTo(m as never, { kind: PatchOpKind.CreateEntity, concept: 'C', id: '1' })
        ArchModelGateway.applyOpTo(m as never, { kind: PatchOpKind.SetField, id: '1', field: 'name', value: 'x' })
        ArchModelGateway.applyOpTo(m as never, { kind: PatchOpKind.AddRef, from: '1', member: 'uses', to: '2' })
        ArchModelGateway.applyOpTo(m as never, { kind: PatchOpKind.RemoveRef, from: '1', member: 'uses', to: '2' })
        ArchModelGateway.applyOpTo(m as never, { kind: PatchOpKind.RemoveEntity, id: '1' })
        expect(m.calls).toEqual(['create C 1', 'set 1.name=x', 'addRef 1.uses->2', 'removeRef 1.uses->2', 'remove 1'])
    })
})
