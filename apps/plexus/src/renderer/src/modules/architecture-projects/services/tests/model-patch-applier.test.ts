import { describe, it, expect } from 'vitest'
import { ModelPatchApplier, ApplyOutcome, type ArchModelHandle } from '../model-patch-applier.js'
import { PatchOpKind, type ModelPatch } from '../../../../../../shared/model-patch-api.js'
import { SkillProblemSeverity, type SkillProblem } from '../../../../../../shared/skill-api.js'

class FakeHandle implements ArchModelHandle {
    applied: string[] = []; saved = 0; restored = 0
    private snap = new Map([['a.todl', 'v1']])
    constructor(public problems: SkillProblem[] = []) {}
    snapshot(): Map<string, string> { return new Map(this.snap) }
    restore(): void { this.restored++ }
    apply(op: { kind: string }): void { this.applied.push(op.kind); if (op.kind === 'boom') throw new Error('bad op') }
    async validate(): Promise<SkillProblem[]> { return this.problems }
    async save(): Promise<void> { this.saved++ }
    notifyChanged(): void {}
}

const patch = (kind: string): ModelPatch => ({ ops: [{ kind } as never] })
const gw = (h: ArchModelHandle | undefined): { resolve: () => Promise<ArchModelHandle | undefined> } => ({ resolve: async () => h })

describe('ModelPatchApplier', () => {
    it('applies a clean patch, validates, and saves', async () => {
        const h = new FakeHandle()
        const r = await new ModelPatchApplier(gw(h)).apply('/p', patch(PatchOpKind.SetField))
        expect(r.outcome).toBe(ApplyOutcome.Applied)
        expect(h.applied).toEqual([PatchOpKind.SetField]); expect(h.saved).toBe(1); expect(h.restored).toBe(0)
    })

    it('rolls back and reports when validation finds an error', async () => {
        const h = new FakeHandle([{ message: 'bad', severity: SkillProblemSeverity.Error }])
        const r = await new ModelPatchApplier(gw(h)).apply('/p', patch(PatchOpKind.SetField))
        expect(r.outcome).toBe(ApplyOutcome.Invalid); expect(h.restored).toBe(1); expect(h.saved).toBe(0)
        expect(r.problems).toHaveLength(1)
    })

    it('rolls back when an op throws', async () => {
        const h = new FakeHandle()
        const r = await new ModelPatchApplier(gw(h)).apply('/p', patch('boom'))
        expect(r.outcome).toBe(ApplyOutcome.Invalid); expect(h.restored).toBe(1); expect(h.saved).toBe(0)
    })

    it('returns NoModel when the gateway has no arch model', async () => {
        const r = await new ModelPatchApplier(gw(undefined)).apply('/p', patch(PatchOpKind.SetField))
        expect(r.outcome).toBe(ApplyOutcome.NoModel)
    })

    it('undo restores the last snapshot and saves', async () => {
        const h = new FakeHandle()
        const a = new ModelPatchApplier(gw(h))
        await a.apply('/p', patch(PatchOpKind.SetField))
        await a.undo()
        expect(h.restored).toBe(1); expect(h.saved).toBe(2) // apply save + undo save
    })
})
