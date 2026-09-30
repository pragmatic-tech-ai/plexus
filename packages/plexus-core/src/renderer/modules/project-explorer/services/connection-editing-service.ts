/**
 * `ConnectionEditingService` — the `IConnectionView` implementation. A thin renderer client
 * over the main-process connection authority (`IConnectionsClient` → the connections:* IPC),
 * adding health decoration, the effective per-project active connection, and the change
 * signal. Mutations delegate to the client and then fire the signal; an active-connection
 * change also triggers reference re-resolution (P5a) via the host. Mirrors P5a's
 * `ReferenceEditingService`.
 */
import type { Disposable } from '@pragmatic-tech-ai/todl-runtime'
import type { SolutionMember } from '@pragmatic-tech-ai/todl'
import type { ConnectionSpec, ConnectionView } from '@pragmatic-tech-ai/todl/package-manager/connections'
import type { IConnectionsClient, ConnectionTestResult } from '../../solution-explorer/services/connections-client.js'
import { ConnectionHealth, type IConnectionView, type ConnectionLeafView } from '../../solution-explorer/services/connection-view.js'

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
    SolutionDefaultConnectionId(): string | undefined
    SetSolutionDefaultConnectionId(id: string | undefined): Promise<void>
    ProjectConnectionOverride(member: SolutionMember): string | undefined
    SetProjectConnectionOverride(member: SolutionMember, id: string | undefined): Promise<void>
    RefreshBasesFor(member: SolutionMember): Promise<void>
}

export class ConnectionEditingService implements IConnectionView
{
    private static readonly StatusActiveConnection = 'Active connection updated'

    private readonly handlers = new Set<(affected: SolutionMember | undefined) => void>()
    private readonly lastTest = new Map<string, ConnectionTestResult>()

    constructor(private readonly client: IConnectionsClient, private readonly host: IConnectionHost)
    {
    }

    public async ConnectionsView(): Promise<readonly ConnectionLeafView[]>
    {
        const views = await this.client.List()
        return views.map((v) => this.decorate(v))
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

    // Set the active solution's default connection (solution.json) — the middle effective-
    // connection tier (override → THIS → global default). Fires the change signal so every
    // active-connection row re-renders against the new default (spec §Reactivity).
    public async SetSolutionDefault(id: string): Promise<void>
    {
        await this.host.SetSolutionDefaultConnectionId(id)
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
        const views = await this.ConnectionsView()
        const byId = new Map(views.map((v) => [v.Id, v]))
        const globalDefault = views.find((v) => v.IsDefault)?.Id
        const candidates = [this.host.ProjectConnectionOverride(member), this.host.SolutionDefaultConnectionId(), globalDefault]
        for (const id of candidates)
        {
            if (id !== undefined)
            {
                const view = byId.get(id)
                if (view !== undefined) return view
            }
        }
        return undefined
    }

    public async SetActiveConnectionFor(member: SolutionMember, connectionId: string | undefined): Promise<void>
    {
        await this.host.SetProjectConnectionOverride(member, connectionId)
        await this.host.RefreshBasesFor(member)
        this.host.SetStatus(ConnectionEditingService.StatusActiveConnection)
        this.fire(member)
    }

    public OnConnectionsViewChanged(handler: (affected: SolutionMember | undefined) => void): Disposable
    {
        this.handlers.add(handler)
        return { dispose: () => { this.handlers.delete(handler) } }
    }

    private decorate(v: ConnectionView): ConnectionLeafView
    {
        const test = this.lastTest.get(v.Id)
        const health = ConnectionEditingService.healthOf(v, test)
        const base: ConnectionLeafView =
        {
            Id: v.Id,
            DisplayName: v.DisplayName,
            RegistryType: v.RegistryType,
            IsDefault: v.IsDefault,
            IsSolutionDefault: v.Id === this.host.SolutionDefaultConnectionId(),
            HasToken: v.HasToken,
            Health: health,
        }
        return health === ConnectionHealth.Unreachable && test?.message !== undefined ? { ...base, Message: test.message } : base
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
