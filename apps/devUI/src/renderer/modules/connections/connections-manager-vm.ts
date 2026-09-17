import {
  Observable,
  RelayCommand,
  ObservableCollection,
  type ICommand,
  type IServiceProvider,
} from "@pragmatic-tech-ai/mural/runtime";
import { ContentHostService, type IActivatable } from "@pragmatic-tech-ai/mural/framework";
import { RegistryClient } from "../../services/registry/registry-client.js";
import { TokenSource } from "../../../main/registry/registry-connection.js";
import { ConnectionVM, type ConnectionHost } from "./connection-vm.js";

// The Connections capability's backing service — the manager for the registry
// connections a package registry can be reached through. Create / edit / remove
// connections, set (or point at an env-var for) their tokens, test them, and pick
// the default. Backed by the shared RegistryClient (connections:* bridge).
//
// Like the Package Manager, this is a master/detail split across the two shell
// regions: the side panel hosts the connection LIST (+ New/status), while the
// SELECTED connection's editor is pushed into the central content host
// (ContentHostService) and rendered there by DataTemplate[ConnectionVM]. A
// lightweight Observable (the app's VM root), not MuralBase.
export class ConnectionsManagerVM extends Observable implements IActivatable, ConnectionHost {
  readonly Connections = new ObservableCollection<ConnectionVM>();
  readonly New: ICommand;

  private _selected: ConnectionVM | undefined = undefined;
  private _status = "";
  private readonly client: RegistryClient;
  private readonly contentHost: ContentHostService;

  constructor(provider: IServiceProvider) {
    super();
    this.client = provider.getRequired(RegistryClient);
    this.contentHost = provider.getRequired(ContentHostService.Key);
    this.New = new RelayCommand(() => void this.newConnection(), undefined, {
      Text: "New connection", Description: "Add a registry connection.",
    });
  }

  get Title(): string { return "Registry connections"; }

  get Selected(): ConnectionVM | undefined { return this._selected; }
  set Selected(v: ConnectionVM | undefined) {
    const old = this._selected;
    if (old === v) return;
    this._selected = v;
    this.RaisePropertyChanged("Selected", old, v);
    this.showSelected();
  }

  get Status(): string { return this._status; }

  // Re-present the selected connection's editor into the content host, which may
  // hold another capability's content after a rail switch.
  OnActivated(): void {
    this.showSelected();
    void this.refresh();
  }

  // ConnectionHost — reload the list from main, preserving the selected id.
  async refresh(): Promise<void> {
    const selectedId = this._selected?.Id;
    const [views, envVars] = await Promise.all([this.client.listConnections(), this.client.listEnvVars()]);
    this.Connections.Clear();
    for (const view of views) this.Connections.Add(new ConnectionVM(view, this.client, this, envVars));
    const reselect = this.Connections.ToArray().find((c) => c.Id === selectedId) ?? this.Connections.ToArray()[0];
    this.Selected = reselect;
    this.showSelected(); // reselect may equal the prior value (setter no-ops) — force the view
    this.setStatus(views.length === 0 ? "No connections. Add one to reach a registry." : "");
  }

  // Route the selected connection (or nothing) into the central content view.
  private showSelected(): void {
    this.contentHost.View(this._selected);
  }

  async removeConnection(id: string): Promise<void> {
    await this.client.removeConnection(id);
    if (this._selected?.Id === id) this.Selected = undefined;
    await this.refresh();
  }

  private async newConnection(): Promise<void> {
    const created = await this.client.addConnection({
      name: "New connection",
      registry: "https://npm.pkg.github.com",
      scope: "@scope",
      org: "org",
      githubApi: "https://api.github.com",
      tokenSource: TokenSource.Stored,
      tokenEnvVar: "",
    });
    await this.refresh();
    this.Selected = this.Connections.ToArray().find((c) => c.Id === created.id) ?? this._selected;
  }

  private setStatus(v: string): void {
    const old = this._status;
    if (old === v) return;
    this._status = v;
    this.RaisePropertyChanged("Status", old, v);
  }
}
