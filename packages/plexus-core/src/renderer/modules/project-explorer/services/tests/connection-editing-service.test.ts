import { describe, it, expect } from 'vitest'
import { SolutionMember } from '@pragmatic-tech-ai/todl'
import { ConnectionEditingService, type IConnectionHost } from '../connection-editing-service.js'
import { ConnectionHealth } from '../../../solution-explorer/services/connection-view.js'
import type { IConnectionsClient } from '../../../solution-explorer/services/connections-client.js'
import type { ConnectionView } from '@pragmatic-tech-ai/todl/package-manager/connections'

const member = new SolutionMember({ path: 'p', type: 'architecture' })

function fakeClient(over: Partial<IConnectionsClient> = {}): IConnectionsClient
{
    const one: ConnectionView = { Id: 'a', DisplayName: 'A', RegistryType: 'npm', Settings: {}, IsDefault: true, HasToken: true }
    return {
        List: async () => [one],
        Add: async () => one,
        Update: async () => one,
        Remove: async () => {},
        SetToken: async () => {},
        UseEnvToken: async () => {},
        SetDefault: async () => {},
        Test: async () => ({ ok: true }),
        EnvVars: async () => [],
        ...over,
    }
}

function fakeHost(over: Partial<IConnectionHost> = {}): IConnectionHost & { refreshed: SolutionMember[]; solutionDefaulted: (string | undefined)[] }
{
    const refreshed: SolutionMember[] = []
    const solutionDefaulted: (string | undefined)[] = []
    return Object.assign({
        refreshed,
        solutionDefaulted,
        ProjectFor: () => ({ Factory: { requiresMetaModel: true } }) as never,
        SetStatus: () => {},
        SolutionDefaultConnectionId: () => undefined,
        SetSolutionDefaultConnectionId: async (id: string | undefined) => { solutionDefaulted.push(id) },
        ProjectConnectionOverride: () => undefined,
        SetProjectConnectionOverride: async () => {},
        RefreshBasesFor: async (m: SolutionMember) => { refreshed.push(m) },
    }, over) as IConnectionHost & { refreshed: SolutionMember[]; solutionDefaulted: (string | undefined)[] }
}

const leaf = (Id: string, IsDefault: boolean, HasToken: boolean): ConnectionView => ({ Id, DisplayName: Id.toUpperCase(), RegistryType: 'npm', Settings: {}, IsDefault, HasToken })

describe('ConnectionEditingService', () =>
{
    it('maps a default connection to Health.Default', async () =>
    {
        const views = await new ConnectionEditingService(fakeClient(), fakeHost()).ConnectionsView()
        expect(views[0]!.Health).toBe(ConnectionHealth.Default)
    })

    it('maps a non-default connection with a token to Health.Ready', async () =>
    {
        const client = fakeClient({ List: async () => [leaf('b', false, true)] })
        const views = await new ConnectionEditingService(client, fakeHost()).ConnectionsView()
        expect(views[0]!.Health).toBe(ConnectionHealth.Ready)
    })

    it('maps a non-default token-less connection to Health.NoCredentials', async () =>
    {
        const client = fakeClient({ List: async () => [leaf('b', false, false)] })
        const views = await new ConnectionEditingService(client, fakeHost()).ConnectionsView()
        expect(views[0]!.Health).toBe(ConnectionHealth.NoCredentials)
    })

    it('after a failed Test the connection decorates Unreachable', async () =>
    {
        const client = fakeClient({ List: async () => [leaf('b', false, true)], Test: async () => ({ ok: false, message: '401' }) })
        const svc = new ConnectionEditingService(client, fakeHost())
        await svc.TestConnection('b')
        const view = (await svc.ConnectionsView())[0]!
        expect(view.Health).toBe(ConnectionHealth.Unreachable)
        expect(view.Message).toBe('401')
    })

    it('ActiveConnectionFor falls back override -> solution default -> global default, skipping a dangling id', async () =>
    {
        const host = fakeHost({ ProjectConnectionOverride: () => 'missing', SolutionDefaultConnectionId: () => undefined })
        const active = await new ConnectionEditingService(fakeClient(), host).ActiveConnectionFor(member)
        expect(active!.Id).toBe('a')   // dangling override + no solution default → global default
    })

    it('SetActiveConnectionFor writes the override, refreshes bases, and signals the member', async () =>
    {
        const host = fakeHost()
        const svc = new ConnectionEditingService(fakeClient(), host)
        const seen: (SolutionMember | undefined)[] = []
        svc.OnConnectionsViewChanged((m) => seen.push(m))
        await svc.SetActiveConnectionFor(member, 'a')
        expect(host.refreshed).toContain(member)
        expect(seen).toContain(member)
    })

    it('a mutator signals a global change (undefined)', async () =>
    {
        const svc = new ConnectionEditingService(fakeClient(), fakeHost())
        const seen: (SolutionMember | undefined)[] = []
        svc.OnConnectionsViewChanged((m) => seen.push(m))
        await svc.SetDefault('a')
        expect(seen).toContain(undefined)
    })

    it('decorates the connection that is the solution default with IsSolutionDefault', async () =>
    {
        const client = fakeClient({ List: async () => [leaf('a', false, true), leaf('b', false, true)] })
        const host = fakeHost({ SolutionDefaultConnectionId: () => 'b' })
        const views = await new ConnectionEditingService(client, host).ConnectionsView()
        expect(views.find((v) => v.Id === 'b')!.IsSolutionDefault).toBe(true)
        expect(views.find((v) => v.Id === 'a')!.IsSolutionDefault).toBe(false)
    })

    it('SetSolutionDefault persists via the host and signals a global change', async () =>
    {
        const host = fakeHost()
        const svc = new ConnectionEditingService(fakeClient(), host)
        const seen: (SolutionMember | undefined)[] = []
        svc.OnConnectionsViewChanged((m) => seen.push(m))
        await svc.SetSolutionDefault('a')
        expect(host.solutionDefaulted).toEqual(['a'])
        expect(seen).toContain(undefined)
    })

    it('IsConsumer reflects the project factory requiresMetaModel flag', () =>
    {
        const consumer = new ConnectionEditingService(fakeClient(), fakeHost())
        expect(consumer.IsConsumer(member)).toBe(true)
        const nonConsumer = new ConnectionEditingService(fakeClient(), fakeHost({ ProjectFor: () => ({ Factory: { requiresMetaModel: false } }) as never }))
        expect(nonConsumer.IsConsumer(member)).toBe(false)
    })
})
