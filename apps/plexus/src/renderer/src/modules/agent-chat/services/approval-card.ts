// View-model for a tool-approval card. Shows the tool + command with three
// commands (Approve once / Always allow <prefix> / Deny) and a depleting
// countdown ring; on expiry it auto-submits AllowOnce. Every view-bound property
// is a registered DP (mural binds via get_property_value).
import { MetaData, MuralBase, RelayCommand, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import { ToolApprovalDecision, type ToolApprovalAnswer, type ToolApprovalRequest } from '../../../../../shared/agent-api.js'

const TICK_MS = 100

export class ToolApprovalCard extends MuralBase
{
    public static readonly ToolNameKey        = MuralBase.RegisterProperty<string>(ToolApprovalCard, 'ToolName', '', MetaData.None)
    public static readonly CommandKey         = MuralBase.RegisterProperty<string>(ToolApprovalCard, 'Command', '', MetaData.None)
    public static readonly HasCommandKey      = MuralBase.RegisterProperty<boolean>(ToolApprovalCard, 'HasCommand', false, MetaData.None)
    public static readonly AllowAlwaysLabelKey= MuralBase.RegisterProperty<string>(ToolApprovalCard, 'AllowAlwaysLabel', '', MetaData.None)
    public static readonly CanAllowAlwaysKey  = MuralBase.RegisterProperty<boolean>(ToolApprovalCard, 'CanAllowAlways', false, MetaData.None)
    // Remaining fraction 1..0 for the ProgressIndicator ring (Value clamps 0..1).
    public static readonly CountdownKey       = MuralBase.RegisterProperty<number>(ToolApprovalCard, 'Countdown', 1, MetaData.None)
    public static readonly IsPendingKey       = MuralBase.RegisterProperty<boolean>(ToolApprovalCard, 'IsPending', true, MetaData.None)
    public static readonly IsAnsweredKey      = MuralBase.RegisterProperty<boolean>(ToolApprovalCard, 'IsAnswered', false, MetaData.None)
    public static readonly RecapKey           = MuralBase.RegisterProperty<string>(ToolApprovalCard, 'Recap', '', MetaData.None)
    public static readonly ApproveOnceCommandKey = MuralBase.RegisterProperty<ICommand>(ToolApprovalCard, 'ApproveOnceCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly AllowAlwaysCommandKey = MuralBase.RegisterProperty<ICommand>(ToolApprovalCard, 'AllowAlwaysCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly DenyCommandKey        = MuralBase.RegisterProperty<ICommand>(ToolApprovalCard, 'DenyCommand', undefined as unknown as ICommand, MetaData.None)

    public readonly Id: string
    private timer: ReturnType<typeof setInterval> | undefined
    private remainingMs: number

    constructor(request: ToolApprovalRequest, private readonly onSubmit: (a: ToolApprovalAnswer) => void, durationMs = 10000)
    {
        super()
        this.Id = request.id
        this.remainingMs = durationMs
        const prefix = request.prefix
        this.set_property_value(ToolApprovalCard.ToolNameKey, request.toolName)
        this.set_property_value(ToolApprovalCard.CommandKey, request.command ?? '')
        this.set_property_value(ToolApprovalCard.HasCommandKey, (request.command ?? '') !== '')
        this.set_property_value(ToolApprovalCard.AllowAlwaysLabelKey, prefix !== undefined ? `Always allow ${prefix}` : `Always allow ${request.toolName}`)
        this.set_property_value(ToolApprovalCard.CanAllowAlwaysKey, true)
        this.set_property_value(ToolApprovalCard.ApproveOnceCommandKey, new RelayCommand(() => this.answer(ToolApprovalDecision.AllowOnce)))
        this.set_property_value(ToolApprovalCard.AllowAlwaysCommandKey, new RelayCommand(() => this.answer(ToolApprovalDecision.AllowAlways)))
        this.set_property_value(ToolApprovalCard.DenyCommandKey, new RelayCommand(() => this.answer(ToolApprovalDecision.Deny)))
        this.timer = setInterval(() => this.tick(durationMs), TICK_MS)
    }

    public get ToolName(): string { return this.get_property_value(ToolApprovalCard.ToolNameKey) }
    public get Command(): string { return this.get_property_value(ToolApprovalCard.CommandKey) }
    public get HasCommand(): boolean { return this.get_property_value(ToolApprovalCard.HasCommandKey) }
    public get AllowAlwaysLabel(): string { return this.get_property_value(ToolApprovalCard.AllowAlwaysLabelKey) }
    public get CanAllowAlways(): boolean { return this.get_property_value(ToolApprovalCard.CanAllowAlwaysKey) }
    public get Countdown(): number { return this.get_property_value(ToolApprovalCard.CountdownKey) }
    public get IsPending(): boolean { return this.get_property_value(ToolApprovalCard.IsPendingKey) }
    public get IsAnswered(): boolean { return this.get_property_value(ToolApprovalCard.IsAnsweredKey) }
    public get Recap(): string { return this.get_property_value(ToolApprovalCard.RecapKey) }
    public get ApproveOnceCommand(): ICommand { return this.get_property_value(ToolApprovalCard.ApproveOnceCommandKey) }
    public get AllowAlwaysCommand(): ICommand { return this.get_property_value(ToolApprovalCard.AllowAlwaysCommandKey) }
    public get DenyCommand(): ICommand { return this.get_property_value(ToolApprovalCard.DenyCommandKey) }

    public dispose(): void { if (this.timer !== undefined) { clearInterval(this.timer); this.timer = undefined } }

    private tick(durationMs: number): void
    {
        this.remainingMs -= TICK_MS
        this.set_property_value(ToolApprovalCard.CountdownKey, Math.max(0, this.remainingMs / durationMs))
        if (this.remainingMs <= 0) this.answer(ToolApprovalDecision.AllowOnce)
    }

    private answer(decision: ToolApprovalDecision): void
    {
        if (this.IsAnswered) return
        this.dispose()
        this.set_property_value(ToolApprovalCard.IsAnsweredKey, true)
        this.set_property_value(ToolApprovalCard.IsPendingKey, false)
        const verb = decision === ToolApprovalDecision.Deny ? 'Denied'
            : decision === ToolApprovalDecision.AllowAlways ? 'Always allowed' : 'Approved'
        this.set_property_value(ToolApprovalCard.RecapKey, `${verb} ${this.ToolName}${this.HasCommand ? `: ${this.Command}` : ''}`)
        this.onSubmit({ id: this.Id, decision })
    }
}
