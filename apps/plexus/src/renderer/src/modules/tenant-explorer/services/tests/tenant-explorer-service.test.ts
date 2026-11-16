import { describe, expect, it } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { AccountServiceKey } from '@pragmatic-tech-ai/plexus-core/renderer/modules/account'
import {
    TargetSource, TargetStatus, type AccountTargets, type EnvironmentTarget, type TargetRef,
} from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { EnvironmentContents, IEnvironmentsApi } from '../../../../../shared/environment-contents-api.js'
import { FakeAccountService, Deferred } from '../../../account/tests/fake-account-service.js'
import { EnvironmentsApiKey } from '../../../../services/environments/environments-contents-source.js'
import { TenantExplorerService } from '../tenant-explorer-service.js'
import { TenantExplorerNodeKind, type TenantExplorerNode } from '../tenant-explorer-node.js'

class TargetAccount extends FakeAccountService
{
    public TargetsCalls = 0
    public Next: () => Promise<AccountTargets> = () => Promise.resolve({ Contribute: [], Publish: [] })

    public override async Targets(): Promise<AccountTargets>
    {
        this.TargetsCalls++
        return this.Next()
    }
}

class FakeEnvApi implements IEnvironmentsApi
{
    public readonly Calls: TargetRef[] = []
    public Result: () => Promise<EnvironmentContents> = () => Promise.resolve({ Applications: [], Graphs: [] })

    public Contents(target: TargetRef): Promise<EnvironmentContents>
    {
        this.Calls.push(target)
        return this.Result()
    }
}

class Fixture
{
    public static Env(id: string, name: string, status = TargetStatus.Running, source = TargetSource.Console): EnvironmentTarget
    {
        return { Id: id, Name: name, Status: status, Source: source }
    }

    public static Make(account: TargetAccount, api?: FakeEnvApi): TenantExplorerService
    {
        const provider = new ServiceProvider()
        provider.registerInstance(AccountServiceKey, account)
        if (api !== undefined) provider.registerInstance(EnvironmentsApiKey, api)
        return new TenantExplorerService(provider)
    }

    public static async Settle(): Promise<void>
    {
        for (let i = 0; i < 10; i++) await Promise.resolve()
    }

    public static Labels(nodes: { Count: number; Get(i: number): TenantExplorerNode }): string[]
    {
        const out: string[] = []
        for (let i = 0; i < nodes.Count; i++) out.push(nodes.Get(i).Label)
        return out
    }
}

describe('TenantExplorerService', () =>
{
    it('signed out: no nodes, not signed in, Targets not called', async () =>
    {
        const account = new TargetAccount()
        const svc = Fixture.Make(account)
        await Fixture.Settle()
        expect(svc.Nodes.Count).toBe(0)
        expect(svc.SignedIn).toBe(false)
        expect(account.TargetsCalls).toBe(0)
    })

    it('signed in: tenant root with de-duped, sorted environments and status labels', async () =>
    {
        const account = new TargetAccount()
        account.SetState({ SignedIn: true, TenantName: 'Acme' })
        account.Next = () => Promise.resolve({
            Contribute: [Fixture.Env('c:b', 'beta'), Fixture.Env('c:a', 'alpha', TargetStatus.Stopped)],
            Publish: [Fixture.Env('c:b', 'beta'), Fixture.Env('p:a', 'alpha', TargetStatus.Failed, TargetSource.Platform)],
        })
        const svc = Fixture.Make(account)
        await Fixture.Settle()
        expect(svc.SignedIn).toBe(true)
        expect(svc.IsEmpty).toBe(false)
        expect(svc.Nodes.Count).toBe(1)
        const root = svc.Nodes.Get(0)
        expect(root.Kind).toBe(TenantExplorerNodeKind.Tenant)
        expect(root.Label).toBe('Acme')
        expect(Fixture.Labels(root.Children)).toEqual(['alpha', 'alpha', 'beta'])
        expect(root.Children.Get(2).Status).toBe('Running')
        expect(root.Children.Get(0).Status).not.toBe('')
    })

    it('signed in with no environments is empty', async () =>
    {
        const account = new TargetAccount()
        account.SetState({ SignedIn: true, TenantName: 'Acme' })
        const svc = Fixture.Make(account)
        await Fixture.Settle()
        expect(svc.IsEmpty).toBe(true)
    })

    it('expanding an environment loads applications then graphs', async () =>
    {
        const account = new TargetAccount()
        account.SetState({ SignedIn: true, TenantName: 'Acme' })
        account.Next = () => Promise.resolve({ Contribute: [Fixture.Env('c:a', 'alpha')], Publish: [] })
        const api = new FakeEnvApi()
        api.Result = () => Promise.resolve({ Applications: [{ Name: 'app', Version: '1.0' }], Graphs: [{ Name: 'g1' }] })
        const svc = Fixture.Make(account, api)
        await Fixture.Settle()
        const env = svc.Nodes.Get(0).Children.Get(0)
        env.OnExpand()
        await Fixture.Settle()
        expect(api.Calls).toEqual([{ Name: 'alpha', Source: TargetSource.Console }])
        expect(Fixture.Labels(env.Children)).toEqual(['app 1.0', 'g1'])
        expect(env.Children.Get(0).Kind).toBe(TenantExplorerNodeKind.Application)
        expect(env.Children.Get(1).Kind).toBe(TenantExplorerNodeKind.Graph)
    })

    it('expanding an empty environment shows one message node', async () =>
    {
        const account = new TargetAccount()
        account.SetState({ SignedIn: true, TenantName: 'Acme' })
        account.Next = () => Promise.resolve({ Contribute: [Fixture.Env('c:a', 'alpha')], Publish: [] })
        const svc = Fixture.Make(account, new FakeEnvApi())
        await Fixture.Settle()
        const env = svc.Nodes.Get(0).Children.Get(0)
        env.OnExpand()
        await Fixture.Settle()
        expect(env.Children.Count).toBe(1)
        expect(env.Children.Get(0).Kind).toBe(TenantExplorerNodeKind.Message)
        expect(env.Children.Get(0).Label).toBe('Nothing deployed')
    })

    it('a failing load yields the failure sentence as a message node', async () =>
    {
        const account = new TargetAccount()
        account.SetState({ SignedIn: true, TenantName: 'Acme' })
        account.Next = () => Promise.resolve({ Contribute: [Fixture.Env('c:s', 'staging')], Publish: [] })
        const api = new FakeEnvApi()
        const sentence = 'The environment staging is not running. Start it from the tenant console.'
        api.Result = () => Promise.reject(new Error(sentence))
        const svc = Fixture.Make(account, api)
        await Fixture.Settle()
        const env = svc.Nodes.Get(0).Children.Get(0)
        env.OnExpand()
        await Fixture.Settle()
        expect(Fixture.Labels(env.Children)).toEqual([sentence])
    })

    it('rebuilds on account change', async () =>
    {
        const account = new TargetAccount()
        const svc = Fixture.Make(account)
        await Fixture.Settle()
        expect(svc.SignedIn).toBe(false)
        account.Next = () => Promise.resolve({ Contribute: [Fixture.Env('c:a', 'alpha')], Publish: [] })
        account.SetState({ SignedIn: true, TenantName: 'Acme' })
        await Fixture.Settle()
        expect(svc.SignedIn).toBe(true)
        expect(svc.Nodes.Get(0).Children.Count).toBe(1)
        account.SetState({ SignedIn: false })
        await Fixture.Settle()
        expect(svc.Nodes.Count).toBe(0)
    })

    it('a stale reload does not clobber a newer one', async () =>
    {
        const account = new TargetAccount()
        account.SetState({ SignedIn: true, TenantName: 'Acme' })
        const slow = new Deferred<AccountTargets>()
        account.Next = () => slow.Promise
        const svc = Fixture.Make(account)
        await Fixture.Settle()
        account.Next = () => Promise.resolve({ Contribute: [Fixture.Env('c:new', 'newer')], Publish: [] })
        svc.OnActivated()
        await Fixture.Settle()
        slow.Resolve({ Contribute: [Fixture.Env('c:old', 'older')], Publish: [] })
        await Fixture.Settle()
        expect(Fixture.Labels(svc.Nodes.Get(0).Children)).toEqual(['newer'])
    })
})
