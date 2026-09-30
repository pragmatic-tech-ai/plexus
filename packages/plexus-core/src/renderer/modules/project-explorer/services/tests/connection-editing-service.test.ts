import { describe, it, expect } from 'vitest'
import type { IPropertyBag } from '@pragmatic-tech-ai/todl-runtime'
import type { SolutionMember } from '@pragmatic-tech-ai/todl'
import {
    BagAddress,
    BagScope,
    ConnectionBag,
    ConnectionBagKind,
    ConnectionSelectionKind,
    ConnectionPurpose,
    RecordPropertyBag,
    type BagVantage,
    type IBagPersister,
} from '@pragmatic-tech-ai/todl'
import type { ConnectionView } from '@pragmatic-tech-ai/todl/package-manager/connections'
import type { IConnectionsClient, ConnectionTestResult } from '../../../solution-explorer/services/connections-client.js'
import { ConnectionScope } from '../../../solution-explorer/services/connection-view.js'
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
    constructor(private readonly views: ConnectionView[]) {}
    List(): Promise<readonly ConnectionView[]> { return Promise.resolve(this.views) }
    Add(): Promise<ConnectionView> { return Promise.resolve(this.views[0]!) }
    Update(): Promise<ConnectionView | undefined> { return Promise.resolve(undefined) }
    Remove(): Promise<void> { return Promise.resolve() }
    SetToken(): Promise<void> { return Promise.resolve() }
    UseEnvToken(): Promise<void> { return Promise.resolve() }
    SetDefault(): Promise<void> { return Promise.resolve() }
    Test(): Promise<ConnectionTestResult> { return Promise.resolve({ ok: true }) }
    EnvVars(): Promise<readonly string[]> { return Promise.resolve([]) }
}

const MEMBER = { Ref: { path: 'projA' } } as unknown as SolutionMember

function setup(globals: ConnectionView[] = [globalConnection('gh', true)])
{
    const solution = new FakeBagPersister(BagScope.Solution)
    const projectLocal = new FakeBagPersister(BagScope.Project)
    const vantage: BagVantage = { Global: new FakeBagPersister(BagScope.Global), Solution: solution, ProjectLocal: projectLocal }
    let status = ''
    const host: IConnectionHost =
    {
        ProjectFor: () => undefined,
        SetStatus: (s) => { status = s },
        RefreshBasesFor: () => Promise.resolve(),
        Vantage: () => Promise.resolve(vantage),
    }
    const service = new ConnectionEditingService(new FakeClient(globals), host)
    return { service, solution, projectLocal, get status() { return status } }
}

describe('ConnectionEditingService over the bag catalog', () =>
{
    it('lists connections from every visible scope, each tagged with its scope', async () =>
    {
        const { service, solution, projectLocal } = setup()
        new ConnectionBag(solution.Create(ConnectionBagKind, 'sol-conn')).DisplayName = 'Solution npm'
        new ConnectionBag(projectLocal.Create(ConnectionBagKind, 'proj-conn')).DisplayName = 'Project npm'

        const views = await service.ConnectionsView()
        const byId = new Map(views.map((v) => [v.Id, v]))
        expect([...byId.keys()].sort()).toEqual(['gh', 'proj-conn', 'sol-conn'])
        expect(byId.get('gh')!.Scope).toBe(ConnectionScope.Global)
        expect(byId.get('sol-conn')!.Scope).toBe(ConnectionScope.Solution)
        expect(byId.get('proj-conn')!.Scope).toBe(ConnectionScope.Project)
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
})
