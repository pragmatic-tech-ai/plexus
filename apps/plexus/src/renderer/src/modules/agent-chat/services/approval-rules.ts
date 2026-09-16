// View-models for the "Approved tools" surface — the persistent per-project
// tool-approval rules, with a Revoke per row. Sourced from the agent bridge
// (listApprovalRules / revokeApprovalRule) through a narrow injectable port so the
// VM is unit-testable without window.api. Every view-bound property is a DP.
import { MetaData, MuralBase, ObservableCollection, RelayCommand, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import type { ApprovalRule } from '../../../../../shared/agent-api.js'

// The bridge subset this surface needs. `projectKey` is the agent's working
// directory (the same key main scopes rules under).
export interface ApprovalRulesPort
{
    list(projectKey: string): Promise<ApprovalRule[]>
    revoke(projectKey: string, rule: ApprovalRule): Promise<void>
}

// One persistent rule row: a label ("Bash: python" or "WebFetch") + a Revoke.
export class ApprovalRuleRow extends MuralBase
{
    public static readonly LabelKey         = MuralBase.RegisterProperty<string>(ApprovalRuleRow, 'Label', '', MetaData.None)
    public static readonly RevokeCommandKey = MuralBase.RegisterProperty<ICommand>(
        ApprovalRuleRow, 'RevokeCommand', undefined as unknown as ICommand, MetaData.None)

    public readonly Rule: ApprovalRule

    constructor(rule: ApprovalRule, onRevoke: (rule: ApprovalRule) => void)
    {
        super()
        this.Rule = rule
        this.set_property_value(ApprovalRuleRow.LabelKey, rule.prefix !== undefined ? `${rule.tool}: ${rule.prefix}` : rule.tool)
        this.set_property_value(ApprovalRuleRow.RevokeCommandKey, new RelayCommand(() => onRevoke(rule)))
    }

    public get Label(): string { return this.get_property_value(ApprovalRuleRow.LabelKey) }
    public get RevokeCommand(): ICommand { return this.get_property_value(ApprovalRuleRow.RevokeCommandKey) }
}

// The list of the current project's rules. Refresh() reloads from the port;
// Revoke() drops one then reloads. `projectKey` is read live each call so the VM
// follows the agent's current working directory.
export class ApprovalRulesVM extends MuralBase
{
    public static readonly RulesKey    = MuralBase.RegisterProperty<ObservableCollection<ApprovalRuleRow>>(
        ApprovalRulesVM, 'Rules', undefined as unknown as ObservableCollection<ApprovalRuleRow>, MetaData.None)
    public static readonly HasRulesKey = MuralBase.RegisterProperty<boolean>(ApprovalRulesVM, 'HasRules', false, MetaData.None)

    constructor(private readonly port: ApprovalRulesPort, private readonly projectKey: () => string)
    {
        super()
        this.set_property_value(ApprovalRulesVM.RulesKey, new ObservableCollection<ApprovalRuleRow>())
    }

    public get Rules(): ObservableCollection<ApprovalRuleRow> { return this.get_property_value(ApprovalRulesVM.RulesKey) }
    public get HasRules(): boolean { return this.get_property_value(ApprovalRulesVM.HasRulesKey) }

    public async Refresh(): Promise<void>
    {
        const rules = await this.port.list(this.projectKey())
        const rows = this.Rules
        rows.Clear()
        for (const rule of rules) rows.Add(new ApprovalRuleRow(rule, (r) => { void this.Revoke(r) }))
        this.set_property_value(ApprovalRulesVM.HasRulesKey, rules.length > 0)
    }

    public async Revoke(rule: ApprovalRule): Promise<void>
    {
        await this.port.revoke(this.projectKey(), rule)
        await this.Refresh()
    }
}
