import { MetaData, MuralBase, RelayCommand, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import { ModelPatchDecision, PatchOpKind, type PatchOp, type ProposedModelPatchRequest } from '../../../../../shared/model-patch-api.js'
import { ApplyOutcome, type ApplyResult } from '../../architecture-projects/services/model-patch-applier.js'

// Transcript card for a proposed model patch (mirrors ToolApprovalCard). Shows the
// summary + one line per op, and Accept / Reject. On Accept the host runs the applier
// (via onDecision) and the card flips to Applied (Undo enabled) or, when the patch is
// invalid, stays pending and surfaces the validation problems. Every view-bound
// property is a registered DP.
export class ModelPatchCard extends MuralBase {
    public static readonly SummaryKey     = MuralBase.RegisterProperty<string>(ModelPatchCard, 'Summary', '', MetaData.None)
    public static readonly OpLinesKey     = MuralBase.RegisterProperty<string[]>(ModelPatchCard, 'OpLines', [], MetaData.None)
    // The op lines joined for a single bound TextBlock (the template renders this).
    public static readonly OpTextKey      = MuralBase.RegisterProperty<string>(ModelPatchCard, 'OpText', '', MetaData.None)
    public static readonly IsPendingKey   = MuralBase.RegisterProperty<boolean>(ModelPatchCard, 'IsPending', true, MetaData.None)
    public static readonly IsAppliedKey   = MuralBase.RegisterProperty<boolean>(ModelPatchCard, 'IsApplied', false, MetaData.None)
    public static readonly IsRejectedKey  = MuralBase.RegisterProperty<boolean>(ModelPatchCard, 'IsRejected', false, MetaData.None)
    public static readonly ProblemTextKey = MuralBase.RegisterProperty<string>(ModelPatchCard, 'ProblemText', '', MetaData.None)
    public static readonly HasProblemsKey = MuralBase.RegisterProperty<boolean>(ModelPatchCard, 'HasProblems', false, MetaData.None)
    public static readonly AcceptCommandKey = MuralBase.RegisterProperty<ICommand>(ModelPatchCard, 'AcceptCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly RejectCommandKey = MuralBase.RegisterProperty<ICommand>(ModelPatchCard, 'RejectCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly UndoCommandKey   = MuralBase.RegisterProperty<ICommand>(ModelPatchCard, 'UndoCommand', undefined as unknown as ICommand, MetaData.None)

    private readonly onDecision: (d: ModelPatchDecision) => Promise<ApplyResult | undefined>
    private readonly onUndo: (() => void) | undefined
    private settled = false

    constructor(
        request: ProposedModelPatchRequest,
        onDecision: (d: ModelPatchDecision) => Promise<ApplyResult | undefined>,
        onUndo?: () => void,
    ) {
        super()
        this.onDecision = onDecision
        this.onUndo = onUndo
        this.set_property_value(ModelPatchCard.SummaryKey, request.patch.summary ?? 'Proposed model change')
        const lines = request.patch.ops.map(o => ModelPatchCard.describe(o))
        this.set_property_value(ModelPatchCard.OpLinesKey, lines)
        this.set_property_value(ModelPatchCard.OpTextKey, lines.join('\n'))
        this.set_property_value(ModelPatchCard.AcceptCommandKey, new RelayCommand(() => { void this.accept() }))
        this.set_property_value(ModelPatchCard.RejectCommandKey, new RelayCommand(() => { void this.reject() }))
        this.set_property_value(ModelPatchCard.UndoCommandKey, new RelayCommand(() => { this.onUndo?.() }))
    }

    public get Summary(): string { return this.get_property_value(ModelPatchCard.SummaryKey) }
    public get OpLines(): string[] { return this.get_property_value(ModelPatchCard.OpLinesKey) }
    public get OpText(): string { return this.get_property_value(ModelPatchCard.OpTextKey) }
    public get IsPending(): boolean { return this.get_property_value(ModelPatchCard.IsPendingKey) }
    public get IsApplied(): boolean { return this.get_property_value(ModelPatchCard.IsAppliedKey) }
    public get IsRejected(): boolean { return this.get_property_value(ModelPatchCard.IsRejectedKey) }
    public get ProblemText(): string { return this.get_property_value(ModelPatchCard.ProblemTextKey) }
    public get HasProblems(): boolean { return this.get_property_value(ModelPatchCard.HasProblemsKey) }
    public get AcceptCommand(): ICommand { return this.get_property_value(ModelPatchCard.AcceptCommandKey) }
    public get RejectCommand(): ICommand { return this.get_property_value(ModelPatchCard.RejectCommandKey) }
    public get UndoCommand(): ICommand { return this.get_property_value(ModelPatchCard.UndoCommandKey) }

    // Run the applier via the host. Applied → flip to applied (Undo enabled). Invalid
    // → stay pending, show problems (the user can still Reject). NoModel / undefined →
    // treat as settled (nothing to apply).
    public async accept(): Promise<void> {
        if (this.settled) return
        const result = await this.onDecision(ModelPatchDecision.Accept)
        if (result?.outcome === ApplyOutcome.Applied) {
            this.settled = true
            this.set_property_value(ModelPatchCard.IsAppliedKey, true)
            this.set_property_value(ModelPatchCard.IsPendingKey, false)
        } else if (result?.outcome === ApplyOutcome.Invalid) {
            this.set_property_value(ModelPatchCard.ProblemTextKey, result.problems.map(p => p.message).join('\n'))
            this.set_property_value(ModelPatchCard.HasProblemsKey, true)
        } else {
            // NoModel / no result — nothing was applied; close the card out.
            this.settled = true
            this.set_property_value(ModelPatchCard.IsPendingKey, false)
        }
    }

    public async reject(): Promise<void> {
        if (this.settled) return
        this.settled = true
        await this.onDecision(ModelPatchDecision.Reject)
        this.set_property_value(ModelPatchCard.IsRejectedKey, true)
        this.set_property_value(ModelPatchCard.IsPendingKey, false)
    }

    private static describe(op: PatchOp): string {
        switch (op.kind) {
            case PatchOpKind.CreateEntity: return `+ create ${op.concept} #${op.id}`
            case PatchOpKind.SetField: return `→ set #${op.id}.${op.field} = ${op.value}`
            case PatchOpKind.AddRef: return `⇄ ${op.from}.${op.member} → ${op.to}`
            case PatchOpKind.RemoveRef: return `✂ ${op.from}.${op.member} ✕ ${op.to}`
            case PatchOpKind.RemoveEntity: return `− remove #${op.id}`
        }
    }
}
