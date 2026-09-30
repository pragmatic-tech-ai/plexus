import { MetaData, MuralBase, RelayCommand, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import { TokenSource, type ConnectionView } from '@pragmatic-tech-ai/todl/package-manager/connections'

// What the connection editor emits on Confirm: the non-secret spec fields the connection
// authority needs, plus (Stored mode only) the write-only secret. `id` is present when editing
// an existing connection. The launcher applies this via IConnectionView (Add/Update + token).
export interface ConnectionEditorResult
{
    id?: string
    displayName: string
    registryType: string
    settings: Record<string, string>
    tokenSource: TokenSource
    tokenEnvVar?: string
    secret?: string
}

// The connection editor dialog's view-model — the npm-shaped New/Edit form for a package
// registry connection. Fields: display name, registry URL, optional scope, and the token
// source (a stored secret entered here, or the name of an environment variable). npm is the
// only registry type today, so the shape is hardcoded (not schema-driven). A MuralBase (not
// the lightweight Observable) because it leans on the DP system: two-way field bindings and a
// CanConfirm that recomputes as the required fields change. The secret is write-only — editing
// an existing connection never echoes its token back (HasToken is shown in the tree instead).
export class ConnectionEditorDialogModel extends MuralBase
{
    private static readonly NpmRegistryType = 'npm'
    private static readonly RegistryKey = 'registry'
    private static readonly ScopeKey = 'scope'
    private static readonly NewHeader = 'New Connection'
    private static readonly EditHeader = 'Edit Connection'

    static readonly HeaderLabelKey = MuralBase.RegisterProperty<string>(
        ConnectionEditorDialogModel, 'HeaderLabel', '', MetaData.None)
    static readonly DisplayNameKey = MuralBase.RegisterProperty<string>(
        ConnectionEditorDialogModel, 'DisplayName', '', MetaData.None)
    static readonly RegistryKeyProp = MuralBase.RegisterProperty<string>(
        ConnectionEditorDialogModel, 'Registry', '', MetaData.None)
    static readonly ScopeKeyProp = MuralBase.RegisterProperty<string>(
        ConnectionEditorDialogModel, 'Scope', '', MetaData.None)
    static readonly UseEnvTokenKey = MuralBase.RegisterProperty<boolean>(
        ConnectionEditorDialogModel, 'UseEnvToken', false, MetaData.None)
    // The inverse of UseEnvToken, mirrored as a DP so the stored-token row can bind its
    // visibility (there is no inverse-boolean converter; ToVisibility only maps truthy→Visible).
    static readonly UseStoredTokenKey = MuralBase.RegisterProperty<boolean>(
        ConnectionEditorDialogModel, 'UseStoredToken', true, MetaData.None)
    static readonly EnvVarKey = MuralBase.RegisterProperty<string>(
        ConnectionEditorDialogModel, 'EnvVar', '', MetaData.None)
    static readonly SecretKey = MuralBase.RegisterProperty<string>(
        ConnectionEditorDialogModel, 'Secret', '', MetaData.None)
    static readonly CanConfirmKey = MuralBase.RegisterProperty<boolean>(
        ConnectionEditorDialogModel, 'CanConfirm', false, MetaData.None)
    static readonly ConfirmCommandKey = MuralBase.RegisterProperty<ICommand>(
        ConnectionEditorDialogModel, 'ConfirmCommand', undefined as unknown as ICommand, MetaData.None)
    static readonly CancelCommandKey = MuralBase.RegisterProperty<ICommand>(
        ConnectionEditorDialogModel, 'CancelCommand', undefined as unknown as ICommand, MetaData.None)

    private readonly id: string | undefined

    // `existing` seeds Edit; undefined is New. `close` resolves the host dialog (a result on
    // Confirm, undefined on Cancel).
    constructor(existing: ConnectionView | undefined, private readonly close: (result: ConnectionEditorResult | undefined) => void)
    {
        super()
        this.id = existing?.Id
        this.set_property_value(ConnectionEditorDialogModel.HeaderLabelKey,
            existing === undefined ? ConnectionEditorDialogModel.NewHeader : ConnectionEditorDialogModel.EditHeader)
        if (existing !== undefined)
        {
            this.set_property_value(ConnectionEditorDialogModel.DisplayNameKey, existing.DisplayName)
            this.set_property_value(ConnectionEditorDialogModel.RegistryKeyProp, existing.Settings[ConnectionEditorDialogModel.RegistryKey] ?? '')
            this.set_property_value(ConnectionEditorDialogModel.ScopeKeyProp, existing.Settings[ConnectionEditorDialogModel.ScopeKey] ?? '')
            this.set_property_value(ConnectionEditorDialogModel.UseEnvTokenKey, existing.TokenSource === TokenSource.Env)
            this.set_property_value(ConnectionEditorDialogModel.EnvVarKey, existing.TokenEnvVar ?? '')
        }
        this.set_property_value(ConnectionEditorDialogModel.ConfirmCommandKey,
            new RelayCommand(() => { if (this.CanConfirm) this.close(this.Result) }))
        this.set_property_value(ConnectionEditorDialogModel.CancelCommandKey,
            new RelayCommand(() => this.close(undefined)))
        for (const key of [ConnectionEditorDialogModel.DisplayNameKey, ConnectionEditorDialogModel.RegistryKeyProp, ConnectionEditorDialogModel.UseEnvTokenKey, ConnectionEditorDialogModel.EnvVarKey])
        {
            this.PropertyChanged(key).subscribe(() => this.recompute())
        }
        this.recompute()
    }

    public get HeaderLabel(): string { return this.get_property_value(ConnectionEditorDialogModel.HeaderLabelKey) }

    public get DisplayName(): string { return this.get_property_value(ConnectionEditorDialogModel.DisplayNameKey) }
    public set DisplayName(v: string) { this.set_property_value(ConnectionEditorDialogModel.DisplayNameKey, v) }

    public get Registry(): string { return this.get_property_value(ConnectionEditorDialogModel.RegistryKeyProp) }
    public set Registry(v: string) { this.set_property_value(ConnectionEditorDialogModel.RegistryKeyProp, v) }

    public get Scope(): string { return this.get_property_value(ConnectionEditorDialogModel.ScopeKeyProp) }
    public set Scope(v: string) { this.set_property_value(ConnectionEditorDialogModel.ScopeKeyProp, v) }

    public get UseEnvToken(): boolean { return this.get_property_value(ConnectionEditorDialogModel.UseEnvTokenKey) }
    public set UseEnvToken(v: boolean) { this.set_property_value(ConnectionEditorDialogModel.UseEnvTokenKey, v) }

    public get UseStoredToken(): boolean { return this.get_property_value(ConnectionEditorDialogModel.UseStoredTokenKey) }

    public get EnvVar(): string { return this.get_property_value(ConnectionEditorDialogModel.EnvVarKey) }
    public set EnvVar(v: string) { this.set_property_value(ConnectionEditorDialogModel.EnvVarKey, v) }

    public get Secret(): string { return this.get_property_value(ConnectionEditorDialogModel.SecretKey) }
    public set Secret(v: string) { this.set_property_value(ConnectionEditorDialogModel.SecretKey, v) }

    public get CanConfirm(): boolean { return this.get_property_value(ConnectionEditorDialogModel.CanConfirmKey) }
    public get ConfirmCommand(): ICommand { return this.get_property_value(ConnectionEditorDialogModel.ConfirmCommandKey) }
    public get CancelCommand(): ICommand { return this.get_property_value(ConnectionEditorDialogModel.CancelCommandKey) }

    // The edited connection as a result. Stored mode carries the secret only when one was
    // entered (blank leaves an existing token untouched); Env mode carries the variable name.
    public get Result(): ConnectionEditorResult
    {
        const settings: Record<string, string> = { [ConnectionEditorDialogModel.RegistryKey]: this.Registry.trim() }
        const scope = this.Scope.trim()
        if (scope.length > 0) settings[ConnectionEditorDialogModel.ScopeKey] = scope
        const result: ConnectionEditorResult = {
            displayName: this.DisplayName.trim(),
            registryType: ConnectionEditorDialogModel.NpmRegistryType,
            settings,
            tokenSource: this.UseEnvToken ? TokenSource.Env : TokenSource.Stored,
        }
        if (this.id !== undefined) result.id = this.id
        if (this.UseEnvToken)
        {
            const envVar = this.EnvVar.trim()
            if (envVar.length > 0) result.tokenEnvVar = envVar
        }
        else if (this.Secret.length > 0)
        {
            result.secret = this.Secret
        }
        return result
    }

    private recompute(): void
    {
        const hasName = this.DisplayName.trim().length > 0
        const hasRegistry = this.Registry.trim().length > 0
        const hasEnvVar = !this.UseEnvToken || this.EnvVar.trim().length > 0
        this.set_property_value(ConnectionEditorDialogModel.CanConfirmKey, hasName && hasRegistry && hasEnvVar)
        this.set_property_value(ConnectionEditorDialogModel.UseStoredTokenKey, !this.UseEnvToken)
    }
}
