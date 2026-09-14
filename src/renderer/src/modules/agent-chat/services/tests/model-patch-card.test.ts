import { describe, it, expect } from 'vitest'
import { ModelPatchCard } from '../model-patch-card.js'
import { PatchOpKind, ModelPatchDecision, type ProposedModelPatchRequest } from '../../../../../../shared/model-patch-api.js'
import { ApplyOutcome, type ApplyResult } from '../../../architecture-projects/services/model-patch-applier.js'
import { SkillProblemSeverity } from '../../../../../../shared/skill-api.js'

const req: ProposedModelPatchRequest = { id: 'mp1', projectPath: '/p', patch: { summary: 'Add Foo',
    ops: [ { kind: PatchOpKind.CreateEntity, concept: 'Service', id: 'foo' },
           { kind: PatchOpKind.SetField, id: 'foo', field: 'name', value: 'Foo' } ] } }

describe('ModelPatchCard', () => {
    it('formats one line per op', () => {
        const card = new ModelPatchCard(req, async () => undefined)
        expect(card.OpLines.length).toBe(2)
        expect(card.OpLines[0]).toContain('Service'); expect(card.OpLines[1]).toContain('name')
        expect(card.Summary).toBe('Add Foo')
    })

    it('Accept that applies flips to applied', async () => {
        const applied: ApplyResult = { outcome: ApplyOutcome.Applied, problems: [] }
        const card = new ModelPatchCard(req, async (d) => d === ModelPatchDecision.Accept ? applied : undefined)
        await card.accept()
        expect(card.IsApplied).toBe(true); expect(card.IsPending).toBe(false)
    })

    it('Accept that is invalid stays pending and shows problems', async () => {
        const invalid: ApplyResult = { outcome: ApplyOutcome.Invalid, problems: [{ message: 'bad ref', severity: SkillProblemSeverity.Error }] }
        const card = new ModelPatchCard(req, async () => invalid)
        await card.accept()
        expect(card.IsPending).toBe(true); expect(card.HasProblems).toBe(true); expect(card.ProblemText).toContain('bad ref')
    })

    it('Reject flips to rejected and forwards the decision', async () => {
        let seen: ModelPatchDecision | undefined
        const card = new ModelPatchCard(req, async (d) => { seen = d; return undefined })
        await card.reject()
        expect(card.IsRejected).toBe(true); expect(card.IsPending).toBe(false); expect(seen).toBe(ModelPatchDecision.Reject)
    })
})
