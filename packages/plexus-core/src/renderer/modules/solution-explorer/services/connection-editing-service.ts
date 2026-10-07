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
    BagScope,
    ConnectionBag,
    ConnectionBagKind,
    type ConnectionSelection,
    type IBagCatalog,
    type BagVantage,
    type ResolvedBag,
} from '@pragmatic-tech-ai/todl'
import type { ConnectionSpec, ConnectionView } from '@pragmatic-tech-ai/todl/package-manager/connections'
import type { IConnectionsClient, ConnectionInspection, ConnectionTestResult } from './connections-client.js'
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
    // The consumer id the engine ConnectionSelection resolves a member by (its manifest id).
    ConsumerIdOf(member: SolutionMember): Promise<string | undefined>
    SetStatus(message: string): void
    RefreshBasesFor(member: SolutionMember): Promise<void>
    // The property-bag vantage: the whole solution (no member) or one member's projects (with
    // ProjectShared/ProjectLocal). Undefined when no solution is open.
    Vantage(member?: SolutionMember): Promise<BagVantage | undefined>
}

export class ConnectionEditingService implements IConnectionView
{
    private static readonly StatusActiveConnection = 'Active connection updated'
    private readonly handlers = new Set<(affected: SolutionMember | undefined) => void>()
    private readonly lastTest = new Map<string, ConnectionTestResult>()
    private readonly catalog: IBagCatalog = new BagCatalog()

    // The bag ops (solution default, per-project active selection, consumer lookup) live in the
    // engine ConnectionSelection; this service keeps the view / health / host / signal surface.
    constructor(
        private readonly client: IConnectionsClient,
        private readonly host: IConnectionHost,
        private readonly selection: ConnectionSelection)
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

    // Set the active solution's default connection (engine: solution-scope `IsDefault`). A
    // default that is only a global connection is adopted at solution scope, using the identity
    // the global inventory (the client) knows it by.
    public async SetSolutionDefault(id: string): Promise<void>
    {
        const global = (await this.client.List()).find((v) => v.Id === id)
        await this.selection.SetSolutionDefault({
            Id: id,
            DisplayName: global?.DisplayName ?? '',
            RegistryType: global?.RegistryType ?? '',
        })
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

    public async InspectConnection(id: string): Promise<ConnectionInspection>
    {
        const inspection = await this.client.Inspect(id)
        this.lastTest.set(id, { ok: inspection.ok, message: inspection.message })
        this.fire(undefined)
        return inspection
    }

    public IsConsumer(member: SolutionMember): boolean
    {
        const project = this.host.ProjectFor(member)
        return project !== undefined && project.Factory.requiresMetaModel === true
    }

    public async ActiveConnectionFor(member: SolutionMember): Promise<ConnectionLeafView | undefined>
    {
        const views = await this.ConnectionsView()
        // The engine resolves the effective id (project-local selection, else nearest default).
        const consumerId = await this.host.ConsumerIdOf(member)
        const effectiveId = consumerId === undefined ? undefined : await this.selection.EffectiveConnectionIdForConsumer(consumerId)
        const effective = effectiveId === undefined ? undefined : views.find((v) => v.Id === effectiveId)
        if (effective !== undefined) return effective
        const solutionDefault = views.find((v) => v.IsSolutionDefault)
        if (solutionDefault !== undefined) return solutionDefault
        return views.find((v) => v.IsDefault)
    }

    // Record the per-project active connection as a PROJECT-LOCAL selection (engine), never
    // solution.json. Clearing it falls back to the solution/global default.
    public async SetActiveConnectionFor(member: SolutionMember, connectionId: string | undefined): Promise<void>
    {
        if (connectionId === undefined) await this.selection.ClearActiveFor(member)
        else await this.selection.SetActiveConnectionFor(member, connectionId)
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
