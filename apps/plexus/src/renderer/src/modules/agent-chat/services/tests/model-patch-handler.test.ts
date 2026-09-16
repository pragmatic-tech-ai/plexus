import { describe, it, expect } from 'vitest'
import { ModelPatchHandler, type PendingCardHost } from '../model-patch-handler.js'
import type { ModelPatchCard } from '../model-patch-card.js'
import { ModelPatchDecision, PatchOpKind, type ModelPatchAnswer, type ProposedModelPatchRequest } from '../../../../../../shared/model-patch-api.js'
import { ApplyOutcome, type ApplyResult, type ModelPatchApplier } from '../../../architecture-projects/services/model-patch-applier.js'
import { SkillProblemSeverity } from '../../../../../../shared/skill-api.js'

const req: ProposedModelPatchRequest = { id: 'mp1', projectPath: '/p', patch: {
    ops: [{ kind: PatchOpKind.SetField, id: 'x', field: 'name', value: 'y' }] } }

class FakeHost implements PendingCardHost {
    added: string[] = []; released: string[] = []
    addPendingCard(id: string): void { this.added.push(id) }
    releasePending(id: string): void { this.released.push(id) }
}
const fakeApplier = (result: ApplyResult): ModelPatchApplier =>
    ({ apply: async () => result, undo: async () => {} }) as unknown as ModelPatchApplier

describe('ModelPatchHandler', () => {
    it('adds a pending card for the request', () => {
        const host = new FakeHost()
        new ModelPatchHandler(fakeApplier({ outcome: ApplyOutcome.Applied, problems: [] }), { resolveModelPatch: () => {} }).handle(req, host)
        expect(host.added).toEqual(['mp1'])
    })

    it('Accept that applies replies accept and releases', async () => {
        const host = new FakeHost(); const answers: ModelPatchAnswer[] = []
        const card = new ModelPatchHandler(fakeApplier({ outcome: ApplyOutcome.Applied, problems: [] }),
            { resolveModelPatch: (a) => { answers.push(a) } }).handle(req, host) as ModelPatchCard
        await card.accept()
        expect(answers).toEqual([{ id: 'mp1', decision: ModelPatchDecision.Accept }])
        expect(host.released).toEqual(['mp1'])
    })

    it('Accept that is invalid neither replies nor releases (card stays pending)', async () => {
        const host = new FakeHost(); const answers: ModelPatchAnswer[] = []
        const card = new ModelPatchHandler(fakeApplier({ outcome: ApplyOutcome.Invalid, problems: [{ message: 'bad', severity: SkillProblemSeverity.Error }] }),
            { resolveModelPatch: (a) => { answers.push(a) } }).handle(req, host) as ModelPatchCard
        await card.accept()
        expect(answers).toEqual([]); expect(host.released).toEqual([])
    })

    it('Reject replies reject and releases without applying', async () => {
        const host = new FakeHost(); const answers: ModelPatchAnswer[] = []
        let applied = false
        const applier = { apply: async () => { applied = true; return { outcome: ApplyOutcome.Applied, problems: [] } }, undo: async () => {} } as unknown as ModelPatchApplier
        const card = new ModelPatchHandler(applier, { resolveModelPatch: (a) => { answers.push(a) } }).handle(req, host) as ModelPatchCard
        await card.reject()
        expect(applied).toBe(false)
        expect(answers).toEqual([{ id: 'mp1', decision: ModelPatchDecision.Reject }])
        expect(host.released).toEqual(['mp1'])
    })
})
