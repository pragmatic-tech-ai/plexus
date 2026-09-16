import { Observable, RelayCommand, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import { McpGatingMode, McpScope, McpTransportKind, type McpServerEntry } from '../../../../../shared/mcp-client-api.js'

// One row in the MCP Servers list: a read-only projection of an entry plus an
// enabled toggle and edit/remove actions. Extends Observable (INPC); only Enabled
// and LastStatus mutate, so the rest are readonly.
export class McpServerRow extends Observable
{
    public readonly Label: string
    public readonly Key: string
    public readonly TransportSummary: string
    public readonly GatingBadge: string
    public readonly ScopeLabel: string
    public readonly EditCommand: ICommand
    public readonly RemoveCommand: ICommand

    private _enabled: boolean
    private _lastStatus = ''

    constructor(
        public readonly Entry: McpServerEntry,
        public readonly Scope: McpScope,
        onEdit: (row: McpServerRow) => void,
        onRemove: (row: McpServerRow) => void,
        private readonly onToggle: (row: McpServerRow, enabled: boolean) => void,
    )
    {
        super()
        this.Key = Entry.key
        this.Label = Entry.label.length > 0 ? Entry.label : Entry.key
        this.TransportSummary = McpServerRow.summarize(Entry)
        this.GatingBadge = McpServerRow.gatingLabel(Entry.gating.mode)
        this.ScopeLabel = Scope === McpScope.Project ? 'Project' : 'Global'
        this._enabled = Entry.enabled
        this.EditCommand = new RelayCommand(() => onEdit(this))
        this.RemoveCommand = new RelayCommand(() => onRemove(this))
    }

    public get Enabled(): boolean { return this._enabled }
    public set Enabled(v: boolean)
    {
        const o = this._enabled; if (o === v) return
        this._enabled = v; this.RaisePropertyChanged('Enabled', o, v)
        this.onToggle(this, v)
    }

    public get LastStatus(): string { return this._lastStatus }
    public set LastStatus(v: string) { const o = this._lastStatus; if (o === v) return; this._lastStatus = v; this.RaisePropertyChanged('LastStatus', o, v) }

    private static summarize(entry: McpServerEntry): string
    {
        const t = entry.transport
        return t.kind === McpTransportKind.Stdio ? `stdio · ${t.command}` : `${t.kind} · ${t.url}`
    }

    private static gatingLabel(mode: McpGatingMode): string
    {
        switch (mode)
        {
            case McpGatingMode.AllowAll: return 'Auto-allow'
            case McpGatingMode.PerTool:  return 'Per-tool'
            default:                     return 'Prompt'
        }
    }
}
