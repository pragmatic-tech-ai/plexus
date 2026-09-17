import {
  ServiceBase,
  ObservableCollection,
  type IServiceProvider,
} from "@pragmatic-tech-ai/mural/runtime";
import { type IActivatable } from "@pragmatic-tech-ai/mural/framework";
import {
  SolutionManagerService,
  SolutionSettingsRegistry,
  SolutionTreeVM,
  SolutionMemberNodeVM,
  type SolutionSettingBag,
} from "@pragmatic-tech-ai/todl";
import type { PackageRef } from "@pragmatic-tech-ai/todl/domain";
import { RegistryClient } from "../../services/registry/registry-client.js";
import { StorageService } from "@pragmatic-tech-ai/plexus-core/renderer/modules/storage";
import { ConnectionBag } from "./connection-bag.js";
import { ConnectionLabels } from "./connection-labels.js";
import { IpcPackageSource } from "./ipc-package-source.js";
import { SolutionCommandsVM } from "./solution-commands-vm.js";

// The Solution Explorer capability's backing service (app-side presentation over
// the package's UI-agnostic SolutionManagerService). It:
//   • contributes the cross-project CONNECTION setting bag (which registry
//     connection the solution's members compile/compose against);
//   • projects the active solution into bindable view state — a New/Open/Save
//     toolbar, the member/folder tree, and the connection picker.
// The manager's host services are registered separately (SolutionServicesRegistration,
// installed from the bootstrap) and resolved by the manager from the container.
export class SolutionExplorerService extends ServiceBase implements IActivatable {
  private _title = "No solution open";
  private _hasSolution = false;
  private _commands: SolutionCommandsVM = undefined as unknown as SolutionCommandsVM;
  private readonly _treeRoots = new ObservableCollection<SolutionMemberNodeVM>();
  // The connection picker binds plain string labels (a mural ComboBox renders
  // string items; object items realize empty). `labels` maps a display label
  // back to its stable connection id for persistence + package-source routing.
  private readonly _connections = new ObservableCollection<string>();
  private labels = new ConnectionLabels([]);
  private _selectedConnection: string | undefined = undefined;
  private _composeStatus = "";

  get Title(): string { return this._title; }
  get HasSolution(): boolean { return this._hasSolution; }
  get Commands(): SolutionCommandsVM { return this._commands; }
  get TreeRoots(): ObservableCollection<SolutionMemberNodeVM> { return this._treeRoots; }
  // The registry connections a solution can be assigned to (display labels from
  // the Connections manager), and the one this solution uses for compose/resolve.
  get Connections(): ObservableCollection<string> { return this._connections; }
  get SelectedConnection(): string | undefined { return this._selectedConnection; }
  set SelectedConnection(v: string | undefined) {
    const old = this._selectedConnection;
    if (old === v) return;
    this._selectedConnection = v;
    this.RaisePropertyChanged("SelectedConnection", old, v);
    // persist to the solution + route the package source (map label → id)
    this.assignConnection(this.labels.idForLabel(v));
  }
  // A one-line result of the last Compose (member/dependency diagnostics summary).
  get ComposeStatus(): string { return this._composeStatus; }

  private readonly manager: SolutionManagerService;
  private readonly settings: SolutionSettingsRegistry;
  private readonly storageRegistry: StorageService;
  private readonly registry: RegistryClient;
  private readonly packageSource: IpcPackageSource;
  private tree: SolutionTreeVM | undefined; // hold a ref so its VMs aren't GC'd

  constructor(provider: IServiceProvider) {
    super(provider);
    this.manager = provider.getRequired(SolutionManagerService.Key);
    this.settings = provider.getRequired(SolutionSettingsRegistry.Key);
    this.storageRegistry = provider.getRequired(StorageService.Key);
    this.registry = provider.getRequired(RegistryClient);
    // The same IpcPackageSource singleton the manager resolves for Compose — we
    // point it at the solution's assigned connection.
    this.packageSource = provider.getRequired(SolutionManagerService.PackageSourceKey) as IpcPackageSource;

    const old = this._commands;
    this._commands = new SolutionCommandsVM({
      newSolution: () => void this.NewSolution(),
      openSolution: () => void this.OpenSolution(),
      save: () => void this.save(),
      compose: () => void this.ComposeSolution(),
    });
    this.RaisePropertyChanged("Commands", old, this._commands);

    // The cross-project setting bag this app offers: the solution's connection.
    ConnectionBag.contribute(this.settings);

    // Re-project whenever the active solution changes.
    this.manager.PropertyChanged("ActiveSolution").subscribe(() => this.refresh());
  }

  OnActivated(): void { this.refresh(); }

  // Public so the Home welcome page can drive the same flows (New/Open) and then
  // navigate the user to this capability.
  public async NewSolution(): Promise<void> {
    const dir = await this.registry.pickDirectory();
    if (dir.length === 0) return; // canceled
    await this.manager.NewSolution(dir);
    this.bindBags();
    this.refresh();
  }

  public async OpenSolution(): Promise<void> {
    const dir = await this.registry.pickDirectory();
    if (dir.length === 0) return;
    await this.OpenSolutionAt(dir);
  }

  // Open a solution at a known folder (no picker) — used by the recent list.
  public async OpenSolutionAt(dir: string): Promise<void> {
    await this.manager.OpenSolution(dir);
    this.bindBags();
    this.refresh();
  }

  private async save(): Promise<void> {
    await this.manager.Save();
  }

  // Compile every member (registering each into the main-side local package
  // store) to obtain its package id + version, then compose those refs into one
  // Domain and surface the cross-project diagnostics. Public so the Home page or
  // a command can drive it. A member that fails to COMPILE is reported here; a
  // member that compiles but fails to LOAD/bind is reported by Compose.
  public async ComposeSolution(): Promise<void> {
    const session = this.manager.ActiveSolution;
    if (session === undefined) { this.setComposeStatus("No solution open."); return; }
    this.setComposeStatus("Composing…");
    const members: PackageRef[] = [];
    const compileErrors: string[] = [];
    for (const member of session.Members.ToArray()) {
      const dir = SolutionExplorerService.joinOs(session.Storage.Root, member.Ref.path);
      const view = await this.registry.compileDir(dir);
      if (!view.ok || view.id === undefined || view.version === undefined) {
        compileErrors.push(`${member.Ref.path} failed to compile (${view.diagnostics.length} diagnostic(s))`);
        continue;
      }
      members.push({ model: view.id, version: view.version });
    }
    const composed = await this.manager.Compose(members);
    const total = compileErrors.length + composed.length;
    this.setComposeStatus(
      total === 0
        ? `Composed ${members.length} member(s) — no cross-project problems.`
        : `${total} problem(s): ${[...compileErrors, ...composed.map((d) => d.message)].join("; ")}`,
    );
  }

  // Materialize the registered bag definitions onto the active session, so the
  // connection bag has a live value to read/write.
  private bindBags(): void {
    this.manager.ActiveSolution?.BindBags(this.settings.Definitions);
  }

  // Project the active solution into the bindable view state.
  private refresh(): void {
    const session = this.manager.ActiveSolution;
    this.setHasSolution(session !== undefined);
    this.setTitle(session === undefined ? "No solution open" : session.Name);

    const roots = this.TreeRoots;
    roots.Clear();
    this.tree = undefined;
    if (session === undefined) {
      this._connections.Clear();
      this.restoreConnection(undefined);
      return;
    }

    this.tree = new SolutionTreeVM(session, (member) =>
      this.storageRegistry.Create(
        StorageService.DefaultBackendId,
        SolutionExplorerService.joinOs(session.Storage.Root, member.Ref.path),
      ),
    );
    for (const node of this.tree.Roots) roots.Add(node);

    // Load the available connections and restore this solution's assigned one.
    void this.loadConnections();
  }

  // Fill the connection picker from the Connections manager (unique display
  // labels), then select the one this solution has persisted — WITHOUT re-persisting.
  private async loadConnections(): Promise<void> {
    const views = await this.registry.listConnections();
    this.labels = new ConnectionLabels(views.map((v) => ({ id: v.id, name: v.name })));
    this._connections.Clear();
    for (const label of this.labels.labels) this._connections.Add(label);
    const persistedId = this.connectionBag()?.Get(ConnectionBag.ConnectionIdKey);
    this.restoreConnection(this.labels.labelForId(persistedId === undefined ? undefined : String(persistedId)));
  }

  // The active solution's connection bag (materialized by bindBags).
  private connectionBag(): SolutionSettingBag | undefined {
    return this.manager.ActiveSolution?.SettingBags.ToArray().find((b) => b.Definition.Id === ConnectionBag.Id);
  }

  // Adopt a selection without writing it back (restore path): update the field +
  // route the package source, but do not touch the (already-persisted) bag.
  private restoreConnection(label: string | undefined): void {
    const old = this._selectedConnection;
    this._selectedConnection = label;
    if (old !== label) this.RaisePropertyChanged("SelectedConnection", old, label);
    this.packageSource.SetConnection(this.labels.idForLabel(label));
  }

  // Persist the chosen connection id into the solution + point the package source
  // at it, so Compose resolves this solution's members from that registry.
  private assignConnection(id: string | undefined): void {
    this.packageSource.SetConnection(id);
    this.connectionBag()?.Set(ConnectionBag.ConnectionIdKey, id ?? "");
  }

  private setComposeStatus(v: string): void {
    const old = this._composeStatus;
    this._composeStatus = v;
    this.RaisePropertyChanged("ComposeStatus", old, v);
  }

  private setTitle(v: string): void {
    const old = this._title;
    this._title = v;
    this.RaisePropertyChanged("Title", old, v);
  }

  private setHasSolution(v: boolean): void {
    const old = this._hasSolution;
    this._hasSolution = v;
    this.RaisePropertyChanged("HasSolution", old, v);
  }

  // Join a (possibly Windows) root folder with a relative POSIX member path
  // using the root's separator — mirrors LocalFileStorage's abs().
  private static joinOs(root: string, rel: string): string {
    const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
    const segments: string[] = [];
    for (const seg of rel.split(/[\\/]+/)) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") segments.pop();
      else segments.push(seg);
    }
    if (segments.length === 0) return root;
    const base = root.endsWith(sep) ? root.slice(0, -sep.length) : root;
    return base + sep + segments.join(sep);
  }
}
