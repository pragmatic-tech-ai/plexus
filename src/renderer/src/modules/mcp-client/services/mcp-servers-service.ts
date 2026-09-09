import {
    MetaData, MuralBase, ObservableCollection, RelayCommand, ServiceBase, ServiceKey,
    type ICommand, type IServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime'
import { type IActivatable } from '@pragmatic-tech-ai/mural/framework'
import { McpScope, type IMcpClientApi, type McpServerEntry } from '../../../../../shared/mcp-client-api.js'
import { OpenProjectsStore } from '../../../services/projects/open-projects-store.js'
import { McpServerRow } from './mcp-server-row.js'
import { McpServerEditor } from './mcp-server-editor.js'
import { McpImport } from './mcp-import.js'

// The "MCP Servers" capability panel root. Lists the global registry plus (when a
// project is open) that project's servers, and hosts the add/edit editor and the
// import panel. A ServiceBase (the capability's ServiceKey) using the DP system for
// its bindable panel state; the child VMs extend the lightweight Observable.
export class McpServersService extends ServiceBase implements IActivatable
{
    public static readonly Key = new ServiceKey<McpServersService>('McpServersService')

    public static readonly IsProjectOpenKey = MuralBase.RegisterProperty<boolean>(McpServersService, 'IsProjectOpen', false, MetaData.None)
    public static readonly IsEmptyKey = MuralBase.RegisterProperty<boolean>(McpServersService, 'IsEmpty', false, MetaData.None)
    public static readonly ActiveEditorKey = MuralBase.RegisterProperty<McpServerEditor | undefined>(McpServersService, 'ActiveEditor', undefined, MetaData.None)
    public static readonly HasEditorKey = MuralBase.RegisterProperty<boolean>(McpServersService, 'HasEditor', false, MetaData.None)
    public static readonly ActiveImportKey = MuralBase.RegisterProperty<McpImport | undefined>(McpServersService, 'ActiveImport', undefined, MetaData.None)
    public static readonly HasImportKey = MuralBase.RegisterProperty<boolean>(McpServersService, 'HasImport', false, MetaData.None)

    public readonly GlobalServers = new ObservableCollection<McpServerRow>()
    public readonly ProjectServers = new ObservableCollection<McpServerRow>()

    public readonly AddCommand: ICommand
    public readonly AddProjectCommand: ICommand
    public readonly ImportCommand: ICommand
    public readonly ReloadCommand: ICommand

    private readonly projects: OpenProjectsStore | undefined

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.projects = provider.get(OpenProjectsStore.Key)
        this.projects?.Subscribe(() => void this.Reload())
        this.AddCommand = new RelayCommand(() => this.beginAdd(McpScope.Global))
        this.AddProjectCommand = new RelayCommand(() => this.beginAdd(McpScope.Project))
        this.ImportCommand = new RelayCommand(() => void this.beginImport())
        this.ReloadCommand = new RelayCommand(() => void this.Reload())
        void this.Reload()
    }

    public get IsProjectOpen(): boolean { return this.get_property_value(McpServersService.IsProjectOpenKey) }
    public get IsEmpty(): boolean { return this.get_property_value(McpServersService.IsEmptyKey) }
    public get ActiveEditor(): McpServerEditor | undefined { return this.get_property_value(McpServersService.ActiveEditorKey) }
    public get HasEditor(): boolean { return this.get_property_value(McpServersService.HasEditorKey) }
    public get ActiveImport(): McpImport | undefined { return this.get_property_value(McpServersService.ActiveImportKey) }
    public get HasImport(): boolean { return this.get_property_value(McpServersService.HasImportKey) }

    public OnActivated(): void { void this.Reload() }

    public async Reload(): Promise<void>
    {
        const api = this.api()
        if (api === undefined) return
        const global = await api.listGlobal()
        this.fill(this.GlobalServers, global, McpScope.Global)

        const root = this.projectRoot()
        this.set_property_value(McpServersService.IsProjectOpenKey, root !== undefined)
        const project = root !== undefined ? await api.listProject(root) : []
        this.fill(this.ProjectServers, project, McpScope.Project)

        this.set_property_value(McpServersService.IsEmptyKey, this.GlobalServers.Count === 0 && this.ProjectServers.Count === 0)
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
        this.set_property_value(McpServersService.ActiveEditorKey, editor)
        this.set_property_value(McpServersService.HasEditorKey, true)
    }

    private closeEditor(): void
    {
        this.set_property_value(McpServersService.ActiveEditorKey, undefined)
        this.set_property_value(McpServersService.HasEditorKey, false)
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
        this.set_property_value(McpServersService.ActiveImportKey, imp)
        this.set_property_value(McpServersService.HasImportKey, true)
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
        this.set_property_value(McpServersService.ActiveImportKey, undefined)
        this.set_property_value(McpServersService.HasImportKey, false)
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
