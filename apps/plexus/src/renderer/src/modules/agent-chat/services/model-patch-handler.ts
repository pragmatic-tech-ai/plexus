import type { MuralBase } from '@pragmatic-tech-ai/mural/runtime'
import { ModelPatchDecision, type ModelPatchAnswer, type ProposedModelPatchRequest } from '../../../../../shared/model-patch-api.js'
import { ApplyOutcome, type ModelPatchApplier } from '../../architecture-projects/services/model-patch-applier.js'
import { ModelPatchCard } from './model-patch-card.js'

// The renderer side of resolveModelPatch (Skills #4): the agent bridge that carries
// the decision back to main.
export interface ModelPatchAgent { resolveModelPatch(answer: ModelPatchAnswer): void | Promise<void> }

// A transcript that can host a pending card and release it (TranscriptReducer).
export interface PendingCardHost
{
    addPendingCard(id: string, card: MuralBase): void
    releasePending(id: string): void
}

// Wires a proposed model patch into a transcript card and mediates Accept/Reject:
// Reject → reply reject; Accept → run the applier, reply accept unless the patch is
// Invalid (the card stays pending so the user can Reject the bad patch); Undo →
// revert. Extracted from ChatSessionsService so the flow is unit-testable.
export class ModelPatchHandler
{
    private readonly applier: ModelPatchApplier | undefined
    private readonly agent: ModelPatchAgent

    constructor(applier: ModelPatchApplier | undefined, agent: ModelPatchAgent)
    {
        this.applier = applier
        this.agent = agent
    }

    handle(req: ProposedModelPatchRequest, host: PendingCardHost): ModelPatchCard
    {
        const card = new ModelPatchCard(
            req,
            async (decision) => {
                if (decision === ModelPatchDecision.Reject)
                {
                    void this.agent.resolveModelPatch({ id: req.id, decision })
                    host.releasePending(req.id)
                    return undefined
                }
                const result = await this.applier?.apply(req.projectPath, req.patch)
                // Resolve the tool on Accept unless the patch was Invalid — then the
                // card stays pending so the user can still Reject it.
                if (result === undefined || result.outcome !== ApplyOutcome.Invalid)
                {
                    void this.agent.resolveModelPatch({ id: req.id, decision: ModelPatchDecision.Accept })
                    host.releasePending(req.id)
                }
                return result
            },
            () => { void this.applier?.undo() },
        )
        host.addPendingCard(req.id, card)
        return card
    }
}
