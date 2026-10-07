import { describe, it, expect } from 'vitest'
import type { IPropertyBag } from '@pragmatic-tech-ai/todl-runtime'
import type { SolutionMember } from '@pragmatic-tech-ai/todl'
import {
    BagAddress,
    BagScope,
    ConnectionBag,
    ConnectionBagKind,
    ConnectionSelectionKind,
    ConnectionSelection,
    ConnectionPurpose,
    RecordPropertyBag,
    type BagVantage,
    type IBagPersister,
} from '@pragmatic-tech-ai/todl'
import type { ConnectionView } from '@pragmatic-tech-ai/todl/package-manager/connections'
import type { IConnectionsClient, ConnectionInspection, ConnectionTestResult } from '../connections-client.js'
import { ConnectionHealth, ConnectionScope } from '../connection-view.js'
import { ConnectionEditingService, type IConnectionHost } from '../connection-editing-service.js'

class FakeBagPersister implements IBagPersister
{
    private readonly live = new Map<string, Map<string, Map<string, unknown>>>()
    constructor(public readonly Scope: BagScope) {}
    Ids(kind: string): readonly string[] { return [...(this.live.get(kind)?.keys() ?? [])] }
    Bag(kind: string, id: string): IPropertyBag { return new RecordPropertyBag(this.ensure(kind, id)) }
    Create(kind: string, id: string): IPropertyBag { return new RecordPropertyBag(this.ensure(kind, id)) }
    Delete(kind: string, id: string): void { this.live.get(kind)?.delete(id) }
    Flush(): Promise<void> { return Promise.resolve() }
    private ensure(kind: string, id: string): Map<string, unknown>
    {
        let byId = this.live.get(kind); if (byId === undefined) { byId = new Map(); this.live.set(kind, byId) }
        let v = byId.get(id); if (v === undefined) { v = new Map(); byId.set(id, v) }
        return v
    }
}

function globalConnection(id: string, isDefault: boolean): ConnectionView
{
    return { Id: id, DisplayName: id, RegistryType: 'npm', Settings: {}, HasToken: true, IsDefault: isDefault } as ConnectionView
}

class FakeClient implements IConnectionsClient
{
    public InspectResult: ConnectionInspection = FakeClient.Healthy
    private static readonly Healthy: ConnectionInspection = { ok: true, message: '', identity: '', scopes: [], scopesSupported: true, packages: [], packagesSupported: true }
    constructor(private readonly views: ConnectionView[]) {}
    List(): Promise<readonly ConnectionView[]> { return Promise.resolve(this.views) }
    Add(): Promise<ConnectionView> { return Promise.resolve(this.views[0]!) }
    Update(): Promise<ConnectionView | undefined> { return Promise.resolve(undefined) }
    Remove(): Promise<void> { return Promise.resolve() }
    SetToken(): Promise<void> { return Promise.resolve() }
    UseEnvToken(): Promise<void> { return Promise.resolve() }
    SetDefault(): Promise<void> { return Promise.resolve() }
    Test(): Promise<ConnectionTestResult> { return Promise.resolve({ ok: true }) }
    Inspect(): Promise<ConnectionInspection> { return Promise.resolve(this.InspectResult) }
    EnvVars(): Promise<readonly string[]> { return Promise.resolve([]) }
}

const MEMBER = { Ref: { path: 'projA' }, Storage: {} } as unknown as SolutionMember

function setup(globals: ConnectionView[] = [globalConnection('gh', true)])
{
    const global = new FakeBagPersister(BagScope.Global)
    const solution = new FakeBagPersister(BagScope.Solution)
    const projectLocal = new FakeBagPersister(BagScope.Project)
    let status = ''
    // Realistic vantage: the solution-wide view (no member) carries Global + Solution only; a
    // member's view adds that project's local scope. Both the host (reads) and the REAL engine
    // ConnectionSelection (writes, via its manager) see the same fake bags.
    const vantageFor = (member?: SolutionMember): BagVantage => (member === undefined
        ? { Global: global, Solution: solution }
        : { Global: global, Solution: solution, ProjectLocal: projectLocal })
    const manager = {
        ActiveSolution: { Members: [MEMBER] },
        BuildVantage: (_g: unknown, member?: SolutionMember) => Promise.resolve(vantageFor(member)),
    }
    const resolver = { ConsumerIdOf: () => Promise.resolve('projA') }
    const selection = new ConnectionSelection(manager as never, resolver as never, global)
    const host: IConnectionHost =
    {
        ProjectFor: () => undefined,
        ConsumerIdOf: () => Promise.resolve('projA'),
        SetStatus: (s) => { status = s },
        RefreshBasesFor: () => Promise.resolve(),
        Vantage: (member) => Promise.resolve(vantageFor(member)),
    }
    const client = new FakeClient(globals)
    const service = new ConnectionEditingService(client, host, selection)
    return { service, client, solution, projectLocal, get status() { return status } }
}

describe('ConnectionEditingService over the bag catalog', () =>
{
    it('lists global + solution connections tagged by scope; a project-scoped bag never leaks into the solution-wide list', async () =>
    {
        const { service, solution, projectLocal } = setup()
        new ConnectionBag(solution.Create(ConnectionBagKind, 'sol-conn')).DisplayName = 'Solution npm'
        new ConnectionBag(projectLocal.Create(ConnectionBagKind, 'proj-conn')).DisplayName = 'Project npm'

        const views = await service.ConnectionsView()
        const byId = new Map(views.map((v) => [v.Id, v]))
        expect([...byId.keys()].sort()).toEqual(['gh', 'sol-conn'])   // project scope is member-local, not solution-wide
        expect(byId.get('gh')!.Scope).toBe(ConnectionScope.Global)
        expect(byId.get('sol-conn')!.Scope).toBe(ConnectionScope.Solution)
    })

    it('setting a per-project active connection writes the project-local connection-selection, not the solution', async () =>
    {
        const { service, solution, projectLocal } = setup()
        new ConnectionBag(solution.Create(ConnectionBagKind, 'sol-conn')).DisplayName = 'Solution npm'

        await service.SetActiveConnectionFor(MEMBER, 'sol-conn')

        const sel = projectLocal.Bag(ConnectionSelectionKind, 'main')
        expect(sel.GetValue(ConnectionPurpose.ReferenceResolution)).toBe(BagAddress.Key(new BagAddress(BagScope.Solution, ConnectionBagKind, 'sol-conn')))
        expect(solution.Ids(ConnectionSelectionKind)).toEqual([])   // never written to the solution
        expect((await service.ActiveConnectionFor(MEMBER))?.Id).toBe('sol-conn')

        await service.SetActiveConnectionFor(MEMBER, undefined)   // clear -> falls back to the default
        expect(projectLocal.Bag(ConnectionSelectionKind, 'main').GetValue(ConnectionPurpose.ReferenceResolution)).toBeFalsy()
        expect((await service.ActiveConnectionFor(MEMBER))?.Id).toBe('gh')
    })

    it('SetSolutionDefault adopts a global-only connection at solution scope with its inventory identity', async () =>
    {
        const { service, solution } = setup([globalConnection('gh', true)])
        await service.SetSolutionDefault('gh')
        const adopted = new ConnectionBag(solution.Bag(ConnectionBagKind, 'gh'))
        expect(adopted.IsDefault).toBe(true)
        expect(adopted.RegistryType).toBe('npm')
    })

    it('SetSolutionDefault maps onto solution-scope IsDefault; IsSolutionDefault reflects it', async () =>
    {
        const { service, solution } = setup()
        new ConnectionBag(solution.Create(ConnectionBagKind, 'sol-a')).DisplayName = 'A'
        new ConnectionBag(solution.Create(ConnectionBagKind, 'sol-b')).DisplayName = 'B'

        await service.SetSolutionDefault('sol-a')
        expect(new ConnectionBag(solution.Bag(ConnectionBagKind, 'sol-a')).IsDefault).toBe(true)
        expect((await service.ConnectionsView()).find((v) => v.Id === 'sol-a')!.IsSolutionDefault).toBe(true)

        await service.SetSolutionDefault('sol-b')   // moves the default
        expect(new ConnectionBag(solution.Bag(ConnectionBagKind, 'sol-a')).IsDefault).toBe(false)
        expect(new ConnectionBag(solution.Bag(ConnectionBagKind, 'sol-b')).IsDefault).toBe(true)
    })

    it('InspectConnection returns the full inspection, marks the connection Unreachable on failure, and fires the change signal', async () =>
    {
        const { service, client } = setup([globalConnection('gh', false)])
        const failed: ConnectionInspection = { ok: false, message: 'nope', identity: '', scopes: [], scopesSupported: true, packages: [], packagesSupported: true }
        client.InspectResult = failed
        let fired = 0
        service.OnConnectionsViewChanged(() => { fired++ })

        const result = await service.InspectConnection('gh')

        expect(result).toEqual(failed)
        expect(fired).toBe(1)
        const leaf = (await service.ConnectionsView()).find((v) => v.Id === 'gh')!
        expect(leaf.Health).toBe(ConnectionHealth.Unreachable)
        expect(leaf.Message).toBe('nope')
    })

    it('InspectConnection returns identity/scopes/packages intact and decorates a healthy connection Ready', async () =>
    {
        const { service, client } = setup([globalConnection('gh', false)])
        const good: ConnectionInspection = { ok: true, message: '', identity: 'alice', scopes: ['read:packages'], scopesSupported: true, packages: ['pkg-a', 'pkg-b'], packagesSupported: true }
        client.InspectResult = good

        const result = await service.InspectConnection('gh')

        expect(result).toEqual(good)
        expect((await service.ConnectionsView()).find((v) => v.Id === 'gh')!.Health).toBe(ConnectionHealth.Ready)
    })
})
