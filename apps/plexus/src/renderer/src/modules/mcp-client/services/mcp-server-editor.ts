import { Observable, ObservableCollection, RelayCommand, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import {
    McpGatingMode, McpTransportKind,
    type IMcpClientApi, type McpServerEntry, type McpTransport, type ValueSource,
} from '../../../../../shared/mcp-client-api.js'
import { KeyValueRow, ToolToggle } from './mcp-editor-rows.js'

// The add/edit form for one MCP server. Transport-aware (stdio vs http/sse fields
// toggled by IsStdio/IsHttp), gating-aware (PerTool reveals a discovered-tools
// checklist), and self-validating. Extends the lightweight Observable INPC root;
// the .mu binds its fields two-way and its option lists / boolean flags one-way,
// so the transport/gating enums never appear in markup.
export class McpServerEditor extends Observable
{
    public readonly TransportKinds: readonly McpTransportKind[] = [McpTransportKind.Stdio, McpTransportKind.Http, McpTransportKind.Sse]
    public readonly GatingModes: readonly McpGatingMode[] = [McpGatingMode.Prompt, McpGatingMode.AllowAll, McpGatingMode.PerTool]
    public readonly EnvRows = new ObservableCollection<KeyValueRow>()
    public readonly HeaderRows = new ObservableCollection<KeyValueRow>()
    public readonly Tools = new ObservableCollection<ToolToggle>()

    public readonly AddEnvCommand: ICommand
    public readonly AddHeaderCommand: ICommand
    public readonly DiscoverToolsCommand: ICommand
    public readonly TestCommand: ICommand
    public readonly SaveCommand: ICommand
    public readonly CancelCommand: ICommand

    // Set by the host service; invoked by Save / Cancel.
    public OnSave: (entry: McpServerEntry) => void = () => {}
    public OnCancel: () => void = () => {}

    private _key = ''
    private _label = ''
    private _selectedTransportKind: McpTransportKind = McpTransportKind.Stdio
    private _command = ''
    private _argsText = ''
    private _url = ''
    private _selectedGating: McpGatingMode = McpGatingMode.Prompt
    private _enabled = true
    private _testStatus = ''
    private _isValid = false

    constructor()
    {
        super()
        this.AddEnvCommand = new RelayCommand(() => this.EnvRows.Add(new KeyValueRow((r) => this.EnvRows.Remove(r))))
        this.AddHeaderCommand = new RelayCommand(() => this.HeaderRows.Add(new KeyValueRow((r) => this.HeaderRows.Remove(r))))
        this.DiscoverToolsCommand = new RelayCommand(() => void this.discoverTools())
        this.TestCommand = new RelayCommand(() => void this.test())
        this.SaveCommand = new RelayCommand(() => { if (this._isValid) this.OnSave(this.toEntry()) })
        this.CancelCommand = new RelayCommand(() => this.OnCancel())
    }

    public get Key(): string { return this._key }
    public set Key(v: string) { const o = this._key; if (o === v) return; this._key = v; this.RaisePropertyChanged('Key', o, v); this.recomputeValid() }

    public get Label(): string { return this._label }
    public set Label(v: string) { const o = this._label; if (o === v) return; this._label = v; this.RaisePropertyChanged('Label', o, v) }

    public get SelectedTransportKind(): McpTransportKind { return this._selectedTransportKind }
    public set SelectedTransportKind(v: McpTransportKind)
    {
        const o = this._selectedTransportKind; if (o === v) return
        this._selectedTransportKind = v; this.RaisePropertyChanged('SelectedTransportKind', o, v)
        this.RaisePropertyChanged('IsStdio', !this.IsStdio, this.IsStdio)
        this.RaisePropertyChanged('IsHttp', !this.IsHttp, this.IsHttp)
        this.recomputeValid()
    }
    public get IsStdio(): boolean { return this._selectedTransportKind === McpTransportKind.Stdio }
    public get IsHttp(): boolean { return this._selectedTransportKind !== McpTransportKind.Stdio }

    public get Command(): string { return this._command }
    public set Command(v: string) { const o = this._command; if (o === v) return; this._command = v; this.RaisePropertyChanged('Command', o, v); this.recomputeValid() }

    public get ArgsText(): string { return this._argsText }
    public set ArgsText(v: string) { const o = this._argsText; if (o === v) return; this._argsText = v; this.RaisePropertyChanged('ArgsText', o, v) }

    public get Url(): string { return this._url }
    public set Url(v: string) { const o = this._url; if (o === v) return; this._url = v; this.RaisePropertyChanged('Url', o, v); this.recomputeValid() }

    public get SelectedGating(): McpGatingMode { return this._selectedGating }
    public set SelectedGating(v: McpGatingMode)
    {
        const o = this._selectedGating; if (o === v) return
        this._selectedGating = v; this.RaisePropertyChanged('SelectedGating', o, v)
        this.RaisePropertyChanged('IsPerTool', !this.IsPerTool, this.IsPerTool)
    }
    public get IsPerTool(): boolean { return this._selectedGating === McpGatingMode.PerTool }

    public get Enabled(): boolean { return this._enabled }
    public set Enabled(v: boolean) { const o = this._enabled; if (o === v) return; this._enabled = v; this.RaisePropertyChanged('Enabled', o, v) }

    public get TestStatus(): string { return this._testStatus }
    public set TestStatus(v: string) { const o = this._testStatus; if (o === v) return; this._testStatus = v; this.RaisePropertyChanged('TestStatus', o, v) }

    public get IsValid(): boolean { return this._isValid }

    private recomputeValid(): void
    {
        const ok = this._key.trim().length > 0 && (this.IsStdio ? this._command.trim().length > 0 : this.isParsableUrl())
        if (ok === this._isValid) return
        const o = this._isValid; this._isValid = ok; this.RaisePropertyChanged('IsValid', o, ok)
    }

    private isParsableUrl(): boolean { try { return new URL(this._url).protocol.length > 0 } catch { return false } }

    // Build a persisted entry from the current form state.
    public toEntry(): McpServerEntry
    {
        const key = this._key.trim()
        const transport: McpTransport = this.IsStdio
            ? { kind: McpTransportKind.Stdio, command: this._command.trim(), args: McpServerEditor.parseArgs(this._argsText), env: McpServerEditor.rowsToSources(this.EnvRows) }
            : { kind: this._selectedTransportKind === McpTransportKind.Sse ? McpTransportKind.Sse : McpTransportKind.Http, url: this._url.trim(), headers: McpServerEditor.rowsToSources(this.HeaderRows) }
        const tools = this._selectedGating === McpGatingMode.PerTool
            ? this.Tools.ToArray().filter((t) => t.Checked).map((t) => t.Name) : []
        return { key, label: this._label.trim().length > 0 ? this._label.trim() : key, transport, enabled: this._enabled, gating: { mode: this._selectedGating, tools } }
    }

    // Seed the form from an existing entry (edit), or a fresh entry (add).
    public static from(entry: McpServerEntry): McpServerEditor
    {
        const e = new McpServerEditor()
        e._key = entry.key
        e._label = entry.label
        e._enabled = entry.enabled
        e._selectedGating = entry.gating.mode
        e._selectedTransportKind = entry.transport.kind
        if (entry.transport.kind === McpTransportKind.Stdio)
        {
            e._command = entry.transport.command
            e._argsText = entry.transport.args.join(' ')
            for (const [k, v] of Object.entries(entry.transport.env)) e.EnvRows.Add(KeyValueRow.from((r) => e.EnvRows.Remove(r), k, v))
        }
        else
        {
            e._url = entry.transport.url
            for (const [k, v] of Object.entries(entry.transport.headers)) e.HeaderRows.Add(KeyValueRow.from((r) => e.HeaderRows.Remove(r), k, v))
        }
        for (const name of entry.gating.tools) e.Tools.Add(new ToolToggle(name, true))
        e.recomputeValid()
        return e
    }

    private async discoverTools(): Promise<void>
    {
        const api = McpServerEditor.api()
        if (api === undefined) return
        try
        {
            const names = await api.listTools(this.toEntry())
            const checked = new Set(this.Tools.ToArray().filter((t) => t.Checked).map((t) => t.Name))
            this.Tools.Clear()
            for (const n of names) this.Tools.Add(new ToolToggle(n, checked.has(n)))
            this.TestStatus = `Discovered ${names.length} tools`
        }
        catch (err) { this.TestStatus = `✗ ${err instanceof Error ? err.message : String(err)}` }
    }

    private async test(): Promise<void>
    {
        const api = McpServerEditor.api()
        if (api === undefined) return
        this.TestStatus = 'Testing…'
        const r = await api.probe(this.toEntry())
        this.TestStatus = r.ok ? `✓ ${r.toolCount ?? 0} tools` : `✗ ${r.error ?? 'failed'}`
    }

    private static api(): IMcpClientApi | undefined
    {
        return (globalThis as unknown as { api?: { mcp?: IMcpClientApi } }).api?.mcp
    }

    private static parseArgs(text: string): string[] { return text.split(/\s+/).filter((s) => s.length > 0) }

    private static rowsToSources(rows: ObservableCollection<KeyValueRow>): Record<string, ValueSource>
    {
        const out: Record<string, ValueSource> = {}
        for (const row of rows.ToArray()) { const name = row.Name.trim(); if (name.length > 0) out[name] = row.toSource() }
        return out
    }
}
