import { Observable, RelayCommand, ObservableCollection, type ICommand } from "@pragmatic-tech-ai/mural/runtime";
import type { RegistryClient } from "../../services/registry/registry-client.js";
import type { ConnectionView } from "../../../main/registry/registry-connection.js";
import { TokenSource } from "../../../main/registry/registry-connection.js";

/** What a ConnectionVM needs back from its owning manager: refresh the list after
 *  a mutation, and remove a connection by id. */
export interface ConnectionHost {
  refresh(): Promise<void>;
  removeConnection(id: string): Promise<void>;
}

// One registry connection, presented as an editable master/detail row. The
// non-secret fields (name, registry, scope, org, github api, env-var name) are
// two-way bound to TextBoxes; the token is write-only (`Token`) — it travels to
// main via setConnectionToken and is cleared here after, never read back
// (the bridge exposes only `HasToken`). A lightweight Observable, not MuralBase.
export class ConnectionVM extends Observable {
  readonly Id: string;

  private _name: string;
  private _registry: string;
  private _scope: string;
  private _org: string;
  private _githubApi: string;
  private _tokenEnvVar: string;
  // The process env-var names the user can pick from for env-backed auth (a mural
  // ComboBox renders string items; env-var names are strings). Includes the
  // connection's current value even if it isn't a live process var, so the picker
  // never silently blanks a saved selection.
  readonly EnvVars = new ObservableCollection<string>();
  private _token = "";
  private _tokenSource: TokenSource;
  private _hasToken: boolean;
  private _isDefault: boolean;
  private _status = "";

  readonly Save: ICommand;
  readonly SaveToken: ICommand;
  readonly UseEnv: ICommand;
  readonly Test: ICommand;
  readonly MakeDefault: ICommand;
  readonly Remove: ICommand;

  constructor(
    view: ConnectionView,
    private readonly client: RegistryClient,
    private readonly host: ConnectionHost,
    envVars: readonly string[] = [],
  ) {
    super();
    this.Id = view.id;
    this._name = view.name;
    this._registry = view.registry;
    this._scope = view.scope;
    this._org = view.org;
    this._githubApi = view.githubApi;
    this._tokenEnvVar = view.tokenEnvVar;
    this._tokenSource = view.tokenSource;
    this._hasToken = view.hasToken;
    this._isDefault = view.isDefault;

    // Seed the env-var picker: the live process vars, plus the saved value if it
    // isn't among them (so a ComboBox SelectedItem = TokenEnvVar still resolves).
    for (const name of envVars) this.EnvVars.Add(name);
    if (this._tokenEnvVar.length > 0 && !envVars.includes(this._tokenEnvVar)) {
      this.EnvVars.Add(this._tokenEnvVar);
    }

    this.Save = new RelayCommand(() => void this.save(), undefined, {
      Text: "Save", Description: "Save this connection's registry settings.",
    });
    this.SaveToken = new RelayCommand(() => void this.saveToken(), undefined, {
      Text: "Save token", Description: "Store an encrypted auth token for this connection.",
    });
    this.UseEnv = new RelayCommand(() => void this.useEnv(), undefined, {
      Text: "Use env var", Description: "Read this connection's token from an environment variable.",
    });
    this.Test = new RelayCommand(() => void this.test(), undefined, {
      Text: "Test", Description: "Try to list this connection's registry.",
    });
    this.MakeDefault = new RelayCommand(() => void this.makeDefault(), undefined, {
      Text: "Set default", Description: "Use this connection for registry operations by default.",
    });
    this.Remove = new RelayCommand(() => void this.host.removeConnection(this.Id), undefined, {
      Text: "Remove", Description: "Delete this connection and its stored token.",
    });
  }

  get Name(): string { return this._name; }
  set Name(v: string) { this.assign("Name", this._name, v, (x) => (this._name = x)); }
  get Registry(): string { return this._registry; }
  set Registry(v: string) { this.assign("Registry", this._registry, v, (x) => (this._registry = x)); }
  get Scope(): string { return this._scope; }
  set Scope(v: string) { this.assign("Scope", this._scope, v, (x) => (this._scope = x)); }
  get Org(): string { return this._org; }
  set Org(v: string) { this.assign("Org", this._org, v, (x) => (this._org = x)); }
  get GithubApi(): string { return this._githubApi; }
  set GithubApi(v: string) { this.assign("GithubApi", this._githubApi, v, (x) => (this._githubApi = x)); }
  get TokenEnvVar(): string { return this._tokenEnvVar; }
  set TokenEnvVar(v: string) { this.assign("TokenEnvVar", this._tokenEnvVar, v, (x) => (this._tokenEnvVar = x)); }
  get Token(): string { return this._token; }
  set Token(v: string) { this.assign("Token", this._token, v, (x) => (this._token = x)); }

  get TokenSource(): string { return this._tokenSource; }
  get HasToken(): boolean { return this._hasToken; }
  get IsDefault(): boolean { return this._isDefault; }
  get Status(): string { return this._status; }

  /** A one-line summary for the master list row. */
  get Summary(): string {
    const marks: string[] = [];
    if (this._isDefault) marks.push("default");
    marks.push(this._hasToken ? "token set" : "no token");
    return `${this._name}  (${marks.join(", ")})`;
  }

  private async save(): Promise<void> {
    await this.client.updateConnection(this.Id, {
      name: this._name,
      registry: this._registry,
      scope: this._scope,
      org: this._org,
      githubApi: this._githubApi,
    });
    this.setStatus("Saved.");
    await this.host.refresh();
  }

  private async saveToken(): Promise<void> {
    if (this._token.length === 0) { this.setStatus("Enter a token first."); return; }
    await this.client.setConnectionToken(this.Id, this._token);
    this.Token = ""; // never keep the secret in the VM
    this.setStatus("Token saved.");
    await this.host.refresh();
  }

  private async useEnv(): Promise<void> {
    if (this._tokenEnvVar.length === 0) { this.setStatus("Enter an environment variable name."); return; }
    await this.client.useConnectionEnvToken(this.Id, this._tokenEnvVar);
    this.setStatus(`Using $${this._tokenEnvVar}.`);
    await this.host.refresh();
  }

  private async test(): Promise<void> {
    this.setStatus("Testing…");
    const result = await this.client.testConnection(this.Id);
    this.setStatus(result.ok ? `Connected — ${result.count} package(s).` : `Failed: ${result.message}`);
  }

  private async makeDefault(): Promise<void> {
    await this.client.setDefaultConnection(this.Id);
    await this.host.refresh();
  }

  private setStatus(v: string): void {
    this.assign("Status", this._status, v, (x) => (this._status = x));
  }

  private assign(name: string, oldValue: string | boolean, value: string, set: (v: string) => void): void {
    if (oldValue === value) return;
    set(value);
    this.RaisePropertyChanged(name, oldValue, value);
  }
}
