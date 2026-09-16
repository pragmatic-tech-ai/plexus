import { ObservableCollection, RelayCommand, ServiceBase, ServiceKey, type ICommand, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { type IActivatable } from '@pragmatic-tech-ai/mural/framework'
import { McpScope, type IMcpClientApi, type McpServerEntry } from '../../../../../shared/mcp-client-api.js'
import { OpenProjectsStore } from '../../../services/projects/open-projects-store.js'
import { McpServerRow } from './mcp-server-row.js'
import { McpServerEditor } from './mcp-server-editor.js'
import { McpImport } from './mcp-import.js'

// The "MCP Servers" capability panel root. Lists the global registry plus (when a
// project is open) that project's servers, and hosts the add/edit editor and the
// import panel. A ServiceBase (the capability's ServiceKey) — but its bindable
// state is exposed as PLAIN Observable properties (getter/setter + RaisePropertyChanged)
// and its commands/lists as plain readonly fields, no dependency-property boilerplate:
// the binding engine reads plain properties on a MuralBase source and subscribes to
// its Observable INPC (mural >= 0.46.16).
export class McpServersService extends ServiceBase implements IActivatable
{
    public static readonly Key = new ServiceKey<McpServersService>('McpServersService')

    public readonly GlobalServers = new ObservableCollection<McpServerRow>()
    public readonly ProjectServers = new ObservableCollection<McpServerRow>()

    public readonly AddCommand: ICommand = new RelayCommand(() => this.beginAdd(McpScope.Global))
    public readonly AddProjectCommand: ICommand = new RelayCommand(() => this.beginAdd(McpScope.Project))
    public readonly ImportCommand: ICommand = new RelayCommand(() => void this.beginImport())
    public readonly ReloadCommand: ICommand = new RelayCommand(() => void this.Reload())

    private _isProjectOpen = false
    private _isEmpty = false
    private _activeEditor: McpServerEditor | undefined
    private _hasEditor = false
    private _activeImport: McpImport | undefined
    private _hasImport = false

    private readonly projects: OpenProjectsStore | undefined

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.projects = provider.get(OpenProjectsStore.Key)
        this.projects?.Subscribe(() => void this.Reload())
        void this.Reload()
    }

    public get IsProjectOpen(): boolean { return this._isProjectOpen }
    private set IsProjectOpen(v: boolean) { const o = this._isProjectOpen; if (o === v) return; this._isProjectOpen = v; this.RaisePropertyChanged('IsProjectOpen', o, v) }

    public get IsEmpty(): boolean { return this._isEmpty }
    private set IsEmpty(v: boolean) { const o = this._isEmpty; if (o === v) return; this._isEmpty = v; this.RaisePropertyChanged('IsEmpty', o, v) }

    public get ActiveEditor(): McpServerEditor | undefined { return this._activeEditor }
    private set ActiveEditor(v: McpServerEditor | undefined) { const o = this._activeEditor; if (o === v) return; this._activeEditor = v; this.RaisePropertyChanged('ActiveEditor', o, v) }

    public get HasEditor(): boolean { return this._hasEditor }
    private set HasEditor(v: boolean) { const o = this._hasEditor; if (o === v) return; this._hasEditor = v; this.RaisePropertyChanged('HasEditor', o, v) }

    public get ActiveImport(): McpImport | undefined { return this._activeImport }
    private set ActiveImport(v: McpImport | undefined) { const o = this._activeImport; if (o === v) return; this._activeImport = v; this.RaisePropertyChanged('ActiveImport', o, v) }

    public get HasImport(): boolean { return this._hasImport }
    private set HasImport(v: boolean) { const o = this._hasImport; if (o === v) return; this._hasImport = v; this.RaisePropertyChanged('HasImport', o, v) }

    public OnActivated(): void { void this.Reload() }

    public async Reload(): Promise<void>
    {
        const api = this.api()
        if (api === undefined) return
        const global = await api.listGlobal()
        this.fill(this.GlobalServers, global, McpScope.Global)

        const root = this.projectRoot()
        this.IsProjectOpen = root !== undefined
        const project = root !== undefined ? await api.listProject(root) : []
        this.fill(this.ProjectServers, project, McpScope.Project)

        this.IsEmpty = this.GlobalServers.Count === 0 && this.ProjectServers.Count === 0
    }

    private fill(target: ObservableCollection<McpServerRow>, entries: readonly McpServerEntry[], scope: McpScope): void
    {
        target.Clear()
        for (const e of entries) target.Add(this.row(e, scope))
    }

    private row(entry: McpServerEntry, scope: McpScope): McpServerRow
    {
        return new McpServerRow(entry, scope,
            (r) => this.beginEdit(r),
            (r) => void this.remove(r),
            (r, enabled) => void this.toggle(r, enabled))
    }

    private beginAdd(scope: McpScope): void
    {
        const editor = new McpServerEditor()
        editor.OnSave = (entry) => void this.save(entry, scope)
        editor.OnCancel = () => this.closeEditor()
        this.showEditor(editor)
    }

    private beginEdit(row: McpServerRow): void
    {
        const editor = McpServerEditor.from(row.Entry)
        editor.OnSave = (entry) => void this.save(entry, row.Scope)
        editor.OnCancel = () => this.closeEditor()
        this.showEditor(editor)
    }

    private showEditor(editor: McpServerEditor): void
    {
        this.ActiveEditor = editor
        this.HasEditor = true
    }

    private closeEditor(): void
    {
        this.ActiveEditor = undefined
        this.HasEditor = false
    }

    private async save(entry: McpServerEntry, scope: McpScope): Promise<void>
    {
        await this.persist(scope, (list) => [...list.filter((s) => s.key !== entry.key), entry])
        this.closeEditor()
        await this.Reload()
    }

    private async remove(row: McpServerRow): Promise<void>
    {
        await this.persist(row.Scope, (list) => list.filter((s) => s.key !== row.Key))
        await this.Reload()
    }

    private async toggle(row: McpServerRow, enabled: boolean): Promise<void>
    {
        await this.persist(row.Scope, (list) => list.map((s) => (s.key === row.Key ? { ...s, enabled } : s)))
        // No reload — the row already reflects the new state; a rebuild would churn.
    }

    private async beginImport(): Promise<void>
    {
        const api = this.api()
        if (api === undefined) return
        const root = this.projectRoot()
        const candidates = await api.importCandidates(root)
        const imp = new McpImport(candidates, root !== undefined)
        imp.OnImport = (entries, scope) => void this.doImport(entries, scope)
        imp.OnCancel = () => this.closeImport()
        this.ActiveImport = imp
        this.HasImport = true
    }

    private async doImport(entries: readonly McpServerEntry[], scope: McpScope): Promise<void>
    {
        await this.persist(scope, (list) => {
            const byKey = new Map(list.map((s) => [s.key, s]))
            for (const e of entries) byKey.set(e.key, e)
            return [...byKey.values()]
        })
        this.closeImport()
        await this.Reload()
    }

    private closeImport(): void
    {
        this.ActiveImport = undefined
        this.HasImport = false
    }

    // Read the scope's current list, transform it, and write it back.
    private async persist(scope: McpScope, transform: (list: McpServerEntry[]) => McpServerEntry[]): Promise<void>
    {
        const api = this.api()
        if (api === undefined) return
        if (scope === McpScope.Global)
        {
            await api.saveGlobal(transform(await api.listGlobal()))
            return
        }
        const root = this.projectRoot()
        if (root === undefined) return
        await api.saveProject(root, transform(await api.listProject(root)))
    }

    private projectRoot(): string | undefined
    {
        const open = this.projects?.Current() ?? []
        return open.length > 0 ? open[0] : undefined
    }

    private api(): IMcpClientApi | undefined
    {
        return (globalThis as unknown as { api?: { mcp?: IMcpClientApi } }).api?.mcp
    }
}
