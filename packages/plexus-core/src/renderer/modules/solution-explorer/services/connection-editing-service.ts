/**
 * `ConnectionEditingService` — the `IConnectionView` implementation. Connections now resolve
 * through the property-bag catalog: the GLOBAL inventory (specs + secrets + registries) stays behind
 * the main-process `IConnectionsClient` (secrets must not cross as values), while SOLUTION/PROJECT
 * connections are property bags, and the per-project active connection is a project-local
 * `connection-selection` (never solution.json). Health decoration, the effective per-project
 * connection, and the change signal ride on top. Mirrors P5a's `ReferenceEditingService`.
 */
import { Disposable, type IDisposable } from '@pragmatic-tech-ai/todl-runtime'
import type { SolutionMember } from '@pragmatic-tech-ai/todl'
import {
    BagCatalog,
    BagAddress,
    BagScope,
    ConnectionBag,
    ConnectionBagKind,
    ConnectionResolution,
    ConnectionPurpose,
    ConnectionSelectionKind,
    type IBagCatalog,
    type BagVantage,
    type ResolvedBag,
} from '@pragmatic-tech-ai/todl'
import type { ConnectionSpec, ConnectionView } from '@pragmatic-tech-ai/todl/package-manager/connections'
import type { IConnectionsClient, ConnectionTestResult } from './connections-client.js'
import { ConnectionHealth, ConnectionScope, type IConnectionView, type ConnectionLeafView } from './connection-view.js'

// A project the host resolves for a member — only the factory flag the consumer gate needs.
// requiresMetaModel is optional to match IProjectFactory (an OpenProject.Factory); the gate
// treats a missing flag as non-consumer.
interface HostProject
{
    Factory: { requiresMetaModel?: boolean }
}

export interface IConnectionHost
{
    ProjectFor(member: SolutionMember): HostProject | undefined
    SetStatus(message: string): void
    RefreshBasesFor(member: SolutionMember): Promise<void>
    // The property-bag vantage: the whole solution (no member) or one member's projects (with
    // ProjectShared/ProjectLocal). Undefined when no solution is open.
    Vantage(member?: SolutionMember): Promise<BagVantage | undefined>
}

export class ConnectionEditingService implements IConnectionView
{
    private static readonly StatusActiveConnection = 'Active connection updated'
    // Must match ConnectionResolution's private selection instance id, so a selection written here is
    // the same one the build-system's ConnectionResolution reads.
    private static readonly SelectionInstanceId = 'main'

    private readonly handlers = new Set<(affected: SolutionMember | undefined) => void>()
    private readonly lastTest = new Map<string, ConnectionTestResult>()
    private readonly catalog: IBagCatalog = new BagCatalog()
    private readonly resolution = new ConnectionResolution(this.catalog)

    constructor(private readonly client: IConnectionsClient, private readonly host: IConnectionHost)
    {
    }

    public async ConnectionsView(): Promise<readonly ConnectionLeafView[]>
    {
        const vantage = await this.host.Vantage()
        const solutionDefaultId = this.solutionDefaultId(vantage)
        const globals = (await this.client.List()).map((v) => this.decorate(v, solutionDefaultId))
        if (vantage === undefined) return globals

        const scoped: ConnectionLeafView[] = []
        for (const resolved of this.catalog.Visible(ConnectionBagKind, vantage))
        {
            if (resolved.Address.Scope === BagScope.Global) continue   // the global inventory is the client's
            scoped.push(ConnectionEditingService.fromBag(resolved))
        }
        return [...globals, ...scoped]
    }

    public EnvVars(): Promise<readonly string[]>
    {
        return this.client.EnvVars()
    }

    public async AddConnection(spec: ConnectionSpec, secret?: string): Promise<void>
    {
        const added = await this.client.Add(spec)
        if (secret !== undefined && secret.length > 0) await this.client.SetToken(added.Id, secret)
        this.fire(undefined)
    }

    public async UpdateConnection(id: string, partial: Partial<ConnectionSpec>): Promise<void>
    {
        await this.client.Update(id, partial)
        this.fire(undefined)
    }

    public async SetToken(id: string, token: string): Promise<void>
    {
        await this.client.SetToken(id, token)
        this.fire(undefined)
    }

    public async UseEnvToken(id: string, varName: string): Promise<void>
    {
        await this.client.UseEnvToken(id, varName)
        this.fire(undefined)
    }

    public async SetDefault(id: string): Promise<void>
    {
        await this.client.SetDefault(id)
        this.fire(undefined)
    }

    // Set the active solution's default connection — now a solution-scope `IsDefault` on the
    // connection bag (was solution.json). A default that is only a global connection is adopted at
    // solution scope (its identity copied), so it resolves as this solution's default.
    public async SetSolutionDefault(id: string): Promise<void>
    {
        const solution = (await this.host.Vantage())?.Solution
        if (solution === undefined) return
        for (const existing of solution.Ids(ConnectionBagKind))
        {
            new ConnectionBag(solution.Bag(ConnectionBagKind, existing)).IsDefault = existing === id
        }
        if (!solution.Ids(ConnectionBagKind).includes(id))
        {
            const adopted = new ConnectionBag(solution.Create(ConnectionBagKind, id))
            adopted.IsDefault = true
            const global = (await this.client.List()).find((v) => v.Id === id)
            if (global !== undefined)
            {
                adopted.DisplayName = global.DisplayName
                adopted.RegistryType = global.RegistryType
            }
        }
        await solution.Flush()
        this.fire(undefined)
    }

    public async RemoveConnection(id: string): Promise<void>
    {
        await this.client.Remove(id)
        this.lastTest.delete(id)
        this.fire(undefined)
    }

    public async TestConnection(id: string): Promise<ConnectionTestResult>
    {
        const result = await this.client.Test(id)
        this.lastTest.set(id, result)
        this.fire(undefined)
        return result
    }

    public IsConsumer(member: SolutionMember): boolean
    {
        const project = this.host.ProjectFor(member)
        return project !== undefined && project.Factory.requiresMetaModel === true
    }

    public async ActiveConnectionFor(member: SolutionMember): Promise<ConnectionLeafView | undefined>
    {
        const vantage = await this.host.Vantage(member)
        const views = await this.ConnectionsView()
        if (vantage !== undefined)
        {
            const selectedKey = this.selectedAddressKey(vantage)
            if (selectedKey !== undefined)
            {
                const selected = views.find((v) => ConnectionEditingService.selectionKeyOf(v) === selectedKey)
                if (selected !== undefined) return selected
            }
        }
        const solutionDefault = views.find((v) => v.IsSolutionDefault)
        if (solutionDefault !== undefined) return solutionDefault
        return views.find((v) => v.IsDefault)
    }

    // Record the per-project active connection as a PROJECT-LOCAL selection (connection-selection),
    // never solution.json. Clearing it falls back to the solution/global default.
    public async SetActiveConnectionFor(member: SolutionMember, connectionId: string | undefined): Promise<void>
    {
        const vantage = await this.host.Vantage(member)
        if (vantage !== undefined)
        {
            if (connectionId === undefined)
            {
                this.resolution.Clear(ConnectionPurpose.ReferenceResolution, vantage)
            }
            else
            {
                const address = new BagAddress(this.scopeOf(connectionId, vantage), ConnectionBagKind, connectionId)
                this.resolution.Select(ConnectionPurpose.ReferenceResolution, address, vantage)
            }
            await vantage.ProjectLocal?.Flush()
        }
        await this.host.RefreshBasesFor(member)
        this.host.SetStatus(ConnectionEditingService.StatusActiveConnection)
        this.fire(member)
    }

    public OnConnectionsViewChanged(handler: (affected: SolutionMember | undefined) => void): IDisposable
    {
        this.handlers.add(handler)
        return new Disposable(() => { this.handlers.delete(handler) })
    }

    private decorate(v: ConnectionView, solutionDefaultId: string | undefined): ConnectionLeafView
    {
        const test = this.lastTest.get(v.Id)
        const health = ConnectionEditingService.healthOf(v, test)
        const base: ConnectionLeafView =
        {
            Id: v.Id,
            DisplayName: v.DisplayName,
            RegistryType: v.RegistryType,
            Scope: ConnectionScope.Global,
            IsDefault: v.IsDefault,
            IsSolutionDefault: v.Id === solutionDefaultId,
            HasToken: v.HasToken,
            Health: health,
        }
        return health === ConnectionHealth.Unreachable && test?.message !== undefined ? { ...base, Message: test.message } : base
    }

    private static fromBag(resolved: ResolvedBag): ConnectionLeafView
    {
        const bag = new ConnectionBag(resolved.Values)
        const isSolutionDefault = resolved.Address.Scope === BagScope.Solution && bag.IsDefault
        const hasToken = ConnectionEditingService.bagHasToken(bag)
        return {
            Id: resolved.Address.Id,
            DisplayName: bag.DisplayName,
            RegistryType: bag.RegistryType,
            Scope: ConnectionEditingService.toConnectionScope(resolved.Address.Scope),
            IsDefault: false,
            IsSolutionDefault: isSolutionDefault,
            HasToken: hasToken,
            Health: isSolutionDefault ? ConnectionHealth.Default : (hasToken ? ConnectionHealth.Ready : ConnectionHealth.NoCredentials),
        }
    }

    // The id of the solution-scope connection bag marked default, or undefined.
    private solutionDefaultId(vantage: BagVantage | undefined): string | undefined
    {
        const solution = vantage?.Solution
        if (solution === undefined) return undefined
        for (const id of solution.Ids(ConnectionBagKind))
        {
            if (new ConnectionBag(solution.Bag(ConnectionBagKind, id)).IsDefault) return id
        }
        return undefined
    }

    // The raw BagAddress.Key a project-local selection points at (scope-preserving — compared, not
    // parsed, so a connection id containing ':' or a same-id-at-another-scope never collapses).
    private selectedAddressKey(vantage: BagVantage): string | undefined
    {
        const local = vantage.ProjectLocal
        if (local === undefined || !local.Ids(ConnectionSelectionKind).includes(ConnectionEditingService.SelectionInstanceId)) return undefined
        const key = local.Bag(ConnectionSelectionKind, ConnectionEditingService.SelectionInstanceId).GetValue(ConnectionPurpose.ReferenceResolution)
        return typeof key === 'string' && key.length > 0 ? key : undefined
    }

    // The selection key SetActiveConnectionFor would store for a view — its scope + id, matching the
    // BagAddress that write constructs (no ProjectStore, as scopeOf produces).
    private static selectionKeyOf(view: ConnectionLeafView): string
    {
        return BagAddress.Key(new BagAddress(ConnectionEditingService.bagScopeOf(view.Scope), ConnectionBagKind, view.Id))
    }

    private static bagScopeOf(scope: ConnectionScope): BagScope
    {
        if (scope === ConnectionScope.Solution) return BagScope.Solution
        if (scope === ConnectionScope.Project) return BagScope.Project
        return BagScope.Global
    }

    // The scope a connection id lives at: a project/solution bag if present, else the global inventory.
    private scopeOf(connectionId: string, vantage: BagVantage): BagScope
    {
        if (vantage.ProjectLocal?.Ids(ConnectionBagKind).includes(connectionId) === true) return BagScope.Project
        if (vantage.ProjectShared?.Ids(ConnectionBagKind).includes(connectionId) === true) return BagScope.Project
        if (vantage.Solution?.Ids(ConnectionBagKind).includes(connectionId) === true) return BagScope.Solution
        return BagScope.Global
    }

    private static bagHasToken(bag: ConnectionBag): boolean
    {
        return bag.TokenEnvVar.length > 0 || bag.TokenRef.length > 0
    }

    private static toConnectionScope(scope: BagScope): ConnectionScope
    {
        if (scope === BagScope.Solution) return ConnectionScope.Solution
        if (scope === BagScope.Project) return ConnectionScope.Project
        return ConnectionScope.Global
    }

    private static healthOf(v: ConnectionView, test: ConnectionTestResult | undefined): ConnectionHealth
    {
        if (test !== undefined && !test.ok) return ConnectionHealth.Unreachable
        if (v.IsDefault) return ConnectionHealth.Default
        if (v.HasToken) return ConnectionHealth.Ready
        return ConnectionHealth.NoCredentials
    }

    private fire(affected: SolutionMember | undefined): void
    {
        for (const handler of this.handlers) handler(affected)
    }
}
