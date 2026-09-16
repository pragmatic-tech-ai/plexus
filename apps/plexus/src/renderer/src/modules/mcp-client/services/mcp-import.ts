import { Observable, ObservableCollection, RelayCommand, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import { McpScope, type McpServerEntry } from '../../../../../shared/mcp-client-api.js'

// One importable server discovered in the user's Claude config.
export class ImportRow extends Observable
{
    public readonly Label: string
    public readonly Summary: string
    private _selected = true

    constructor(public readonly Entry: McpServerEntry)
    {
        super()
        this.Label = Entry.label.length > 0 ? Entry.label : Entry.key
        this.Summary = Entry.transport.kind === 'stdio'
            ? `stdio · ${(Entry.transport as { command: string }).command}`
            : `${Entry.transport.kind} · ${(Entry.transport as { url: string }).url}`
    }

    public get Selected(): boolean { return this._selected }
    public set Selected(v: boolean) { const o = this._selected; if (o === v) return; this._selected = v; this.RaisePropertyChanged('Selected', o, v) }
}

// The import panel: candidates read from ~/.claude.json / .mcp.json, a target
// scope, and Import / Cancel. The host service wires OnImport with the chosen
// entries + scope and OnCancel.
export class McpImport extends Observable
{
    public readonly Candidates = new ObservableCollection<ImportRow>()
    public readonly Scopes: readonly McpScope[] = [McpScope.Global, McpScope.Project]
    public readonly ImportCommand: ICommand
    public readonly CancelCommand: ICommand

    public OnImport: (entries: McpServerEntry[], scope: McpScope) => void = () => {}
    public OnCancel: () => void = () => {}

    private _selectedScope: McpScope = McpScope.Global
    private _projectAvailable: boolean

    constructor(candidates: readonly McpServerEntry[], projectAvailable: boolean)
    {
        super()
        this._projectAvailable = projectAvailable
        for (const c of candidates) this.Candidates.Add(new ImportRow(c))
        this.ImportCommand = new RelayCommand(() => this.OnImport(this.selectedEntries(), this._selectedScope))
        this.CancelCommand = new RelayCommand(() => this.OnCancel())
    }

    public get SelectedScope(): McpScope { return this._selectedScope }
    public set SelectedScope(v: McpScope) { const o = this._selectedScope; if (o === v) return; this._selectedScope = v; this.RaisePropertyChanged('SelectedScope', o, v) }

    public get ProjectAvailable(): boolean { return this._projectAvailable }
    public get IsEmpty(): boolean { return this.Candidates.Count === 0 }

    private selectedEntries(): McpServerEntry[] { return this.Candidates.ToArray().filter((r) => r.Selected).map((r) => r.Entry) }
}
