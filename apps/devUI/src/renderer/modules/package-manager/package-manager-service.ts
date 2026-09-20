import {
    ServiceBase,
    ObservableCollection,
    type IServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime';
import {
    ContentHostService,
    DialogService,
    type IActivatable,
} from '@pragmatic-tech-ai/mural/framework';
import { RegistryClient } from '../../services/registry/registry-client.js';
import { PackageManagerHeaderVM } from './package-manager-header-vm.js';
import { EditorPaneVM } from './editor-pane-vm.js';
import { GraphPaneVM } from './graph/graph-pane-vm.js';
import { TreeNodeVM } from './tree-node-vm.js';
import { DeletePackageDialog, DeleteScope } from './delete-package-dialog.js';
import { EditorLanguage } from '../../editor/monaco-editor-host.js';

// The Package Manager capability's backing service. Connects to the registry
// (via the shared RegistryClient) and drives two regions: the side panel shows a
// per-package content TreeView ($Roots, data-driven), and the central content
// host shows the shared editor pane. Selecting a content leaf routes its text +
// language into the editor.
//
// A ServiceBase (bindable, MuralBase-backed) so the side-panel template binds
// $Status / $Roots / $SelectedNode directly. Fetches lazily: OnActivated loads
// the package name list on first open; each package's tarball contents are
// fetched the first time its node is expanded (TreeNodeVM.OnExpand). The header
// Refresh command reloads the list.
export class PackageManagerService extends ServiceBase implements IActivatable
{
    private _status = '';
    private readonly _roots = new ObservableCollection<TreeNodeVM>();
    private _selectedNode: TreeNodeVM | undefined = undefined;
    private _commands: PackageManagerHeaderVM = undefined as unknown as PackageManagerHeaderVM;

    get Status(): string
    {
        return this._status;
    }
    get Roots(): ObservableCollection<TreeNodeVM>
    {
        return this._roots;
    }
    get SelectedNode(): TreeNodeVM | undefined
    {
        return this._selectedNode;
    }
    set SelectedNode(v: TreeNodeVM | undefined)
    {
        const old = this._selectedNode;
        this._selectedNode = v;
        this.RaisePropertyChanged('SelectedNode', old, v);
    }
    get Commands(): PackageManagerHeaderVM
    {
        return this._commands;
    }

    private setStatus(v: string): void
    {
        const old = this._status;
        this._status = v;
        this.RaisePropertyChanged('Status', old, v);
    }

    private readonly registry: RegistryClient;
    private readonly contentHost: ContentHostService;
    private readonly dialogs: DialogService;
    private readonly editorPane = new EditorPaneVM();
    // A compiled model.json leaf (e.g. "Raw model.json" / "Compiled code") routes
    // to this tabbed Visual+Text pane instead of the plain editor.
    private readonly graphPane = new GraphPaneVM();
    // Guards the lazy first load so re-selecting the capability doesn't refetch;
    // the Refresh command bypasses it (it always reloads).
    private loaded = false;

    constructor(provider: IServiceProvider)
    {
        super(provider);
        this.registry = provider.getRequired(RegistryClient);
        this.contentHost = provider.getRequired(ContentHostService.Key);
        this.dialogs = provider.getRequired(DialogService.Key);
        // The side-pane command ToolBar's Refresh + Delete affordances (rendered via
        // DataTemplate[PackageManagerHeaderVM] as a ToolBar pinned atop the body).
        // Delete is gated to package rows (a node carrying a Package identity).
        const oldCommands = this._commands;
        this._commands = new PackageManagerHeaderVM(
            () => this.refresh(),
            () => void this.deleteSelected(),
            () => this.SelectedNode?.Package !== undefined,
        );
        this.RaisePropertyChanged('Commands', oldCommands, this._commands);
        // Selecting a tree node (SelectedDataItem binds two-way) shows a leaf's
        // content; branch/package rows carry none, so they no-op. A JSON leaf that
        // parses as a compiled TodlDocument graph (Raw model.json / Compiled code)
        // routes to the tabbed Visual+Text pane; everything else to the plain editor.
        // Every selection change also re-evaluates the Delete command's enabled state.
        this.PropertyChanged('SelectedNode').subscribe(() => {
            this._commands.notifyDeletableChanged();
            const content = this.SelectedNode?.Content;
            if (content === undefined) return;
            if (
                content.language === EditorLanguage.Json &&
                GraphPaneVM.looksLikeGraph(content.text)
            )
            {
                this.graphPane.show(content.text);
                this.contentHost.View(this.graphPane);
            }
            else
            {
                this.editorPane.show(content.text, content.language);
                this.contentHost.View(this.editorPane);
            }
        });
    }

    // IActivatable — the capability became active. Load the list once on first
    // open, and (re-)present the shared editor pane into the content host, which
    // may hold another capability's content after a switch.
    OnActivated(): void
    {
        if (!this.loaded) void this.load();
        this.contentHost.View(this.editorPane);
    }

    // Reload on demand (the header Refresh command).
    refresh(): void
    {
        void this.load();
    }

    // Delete the selected published package (the header Delete command). Asks the
    // user whether to drop every version or a single one, then confirms the
    // (irreversible) delete before hitting the owning connection's registry.
    private async deleteSelected(): Promise<void>
    {
        const pkg = this.SelectedNode?.Package;
        if (pkg === undefined) return;
        // Fetch the version list from the owning connection to populate the picker.
        let versions: readonly string[];
        let latest: string;
        try
        {
            const contents = await this.registry.getPackageContents(pkg.name, pkg.connectionId);
            versions = contents.versions;
            latest = contents.latest;
        }
        catch (e)
        {
            this.setStatus(`Could not read ${pkg.name}: ${(e as Error).message}`);
            return;
        }
        if (versions.length === 0)
        {
            this.setStatus(`${pkg.name} has no published versions.`);
            return;
        }

        const choice = await DeletePackageDialog.show(this.dialogs, {
            name: pkg.name,
            versions,
            latest,
        });
        if (choice === undefined) return; // cancelled

        const summary =
            choice.scope === DeleteScope.AllVersions
                ? `all ${versions.length} version(s) of ${pkg.name}`
                : `${pkg.name}@${choice.version}`;
        const confirmed = await this.dialogs.Confirm({
            Title: 'Delete published package',
            Message: `Permanently delete ${summary} from the registry? This cannot be undone.`,
            ConfirmLabel: 'Delete',
        });
        if (!confirmed) return;

        this.setStatus(`Deleting ${summary}…`);
        try
        {
            if (choice.scope === DeleteScope.AllVersions)
            {
                await this.registry.deleteAllVersions(pkg.name, pkg.connectionId);
            }
            else
            {
                await this.registry.deleteVersion(pkg.name, choice.version!, pkg.connectionId);
            }
            this.setStatus(`Deleted ${summary}.`);
            void this.load(); // refresh the tree so the removed package/version disappears
        }
        catch (e)
        {
            this.setStatus(`Delete failed: ${(e as Error).message}`);
        }
    }

    // The tree roots are the registry connections; each expands to its packages
    // (connection-scoped), and each package to its category nodes. Browsing spans
    // all connections at once — no active-connection selection.
    private async load(): Promise<void>
    {
        this.setStatus('Loading…');
        try
        {
            const connections = await this.registry.listConnections();
            const roots = this.Roots;
            roots.Clear();
            for (const conn of connections)
                roots.Add(TreeNodeVM.lazy(conn.DisplayName, () => this.loadPackages(conn.Id)));
            this.loaded = true;
            this.setStatus(
                connections.length === 0 ? 'No connections. Add one in the Connections view.' : '',
            );
        }
        catch (e)
        {
            this.setStatus('Could not load connections: ' + (e as Error).message);
        }
    }

    // A connection's package names → lazy package nodes. A per-connection failure
    // (e.g. a 401 from a missing/expired token) surfaces as a leaf under that
    // connection, leaving the other connections browsable.
    private async loadPackages(connectionId: string): Promise<TreeNodeVM[]>
    {
        try
        {
            const names = await this.registry.list(connectionId);
            if (names.length === 0)
                return [TreeNodeVM.leaf('(no packages)', '', EditorLanguage.PlainText)];
            return names.map((name) =>
                TreeNodeVM.package(name, connectionId, () =>
                    this.loadCategories(name, connectionId),
                ),
            );
        }
        catch (e)
        {
            return [
                TreeNodeVM.leaf('Error: ' + (e as Error).message, '', EditorLanguage.PlainText),
            ];
        }
    }

    // Fetch a package's tarball contents (one round-trip, from the owning
    // connection) and build its category nodes: Files (each .todl), Metadata,
    // package.json, Compiled code, Raw model.json, Dependencies, Published versions.
    private async loadCategories(name: string, connectionId: string): Promise<TreeNodeVM[]>
    {
        const c = await this.registry.getPackageContents(name, connectionId);
        const nodes: TreeNodeVM[] = [];
        if (c.files.length > 0)
        {
            nodes.push(
                TreeNodeVM.branch(
                    'Files',
                    c.files.map((f) => TreeNodeVM.leaf(f.name, f.text, EditorLanguage.Todl)),
                ),
            );
        }
        nodes.push(TreeNodeVM.leaf('Metadata', c.metadata, EditorLanguage.Json));
        nodes.push(TreeNodeVM.leaf('package.json', c.packageJson, EditorLanguage.Json));
        nodes.push(TreeNodeVM.leaf('Compiled code', c.compiled, EditorLanguage.Json));
        nodes.push(TreeNodeVM.leaf('Raw model.json', c.rawModel, EditorLanguage.Json));
        if (c.resources.length > 0)
        {
            nodes.push(
                TreeNodeVM.branch(
                    'Resources',
                    c.resources.map((r) =>
                        TreeNodeVM.leaf(r.name, r.text, PackageManagerService.languageFor(r.name)),
                    ),
                ),
            );
        }
        nodes.push(
            TreeNodeVM.branch(
                'Dependencies',
                c.dependencies.map((d) => TreeNodeVM.leaf(d, d, EditorLanguage.PlainText)),
            ),
        );
        nodes.push(
            TreeNodeVM.branch(
                'Published versions',
                c.versions.map((v) =>
                    TreeNodeVM.leaf(
                        v,
                        v === c.latest ? `${v}  (latest)` : v,
                        EditorLanguage.PlainText,
                    ),
                ),
            ),
        );
        return nodes;
    }

    // The editor language for a resource file, inferred from its extension.
    private static languageFor(name: string): EditorLanguage
    {
        if (name.endsWith('.json')) return EditorLanguage.Json;
        if (name.endsWith('.todl')) return EditorLanguage.Todl;
        return EditorLanguage.PlainText;
    }
}
