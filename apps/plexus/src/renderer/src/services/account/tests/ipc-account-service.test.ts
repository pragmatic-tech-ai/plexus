import { afterEach, describe, expect, it } from 'vitest'
import { AccountError, AccountErrorKind } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import IpcAccountService from '../ipc-account-service.js'

class FakeAccountBridge
{
    public readonly Calls: unknown[][] = []
    public Listener: ((s: unknown) => void) | undefined
    public Disposed = false
    public Reply: unknown = { Ok: true, Value: { SignedIn: false } }

    public State(): Promise<unknown> { return Promise.resolve(this.Reply) }
    public Discover(p: string, e: string): Promise<unknown>
    {
        this.Calls.push(['Discover', p, e])
        return Promise.resolve({ Ok: true, Value: [{ Id: 't', DisplayName: 'T' }] })
    }
    public SignIn(p: string, e: string, t: string): Promise<unknown>
    {
        this.Calls.push(['SignIn', p, e, t])
        return Promise.resolve(this.Reply)
    }
    public CancelSignIn(): Promise<unknown> { this.Calls.push(['Cancel']); return Promise.resolve({ Ok: true, Value: undefined }) }
    public SignOut(): Promise<unknown> { return Promise.resolve({ Ok: true, Value: { SignedIn: false } }) }
    public Targets(): Promise<unknown> { return Promise.resolve({ Ok: true, Value: { Contribute: [], Publish: [] } }) }
    public LastChoice(k: string): Promise<unknown> { this.Calls.push(['LastChoice', k]); return Promise.resolve({ Ok: true, Value: { Environment: 'e' } }) }
    public RememberChoice(k: string, c: unknown): Promise<unknown> { this.Calls.push(['Remember', k, c]); return Promise.resolve({ Ok: true, Value: undefined }) }
    public OnChanged(cb: (s: unknown) => void): () => void
    {
        this.Listener = cb
        return () => { this.Disposed = true }
    }
}

describe('IpcAccountService', () =>
{
    afterEach(() =>
    {
        delete (globalThis as any).api
    })

    function Make(bridge = new FakeAccountBridge()): { Bridge: FakeAccountBridge; Service: IpcAccountService }
    {
        (globalThis as any).api = { account: bridge }
        return { Bridge: bridge, Service: new IpcAccountService() }
    }

    it('throws when the bridge is unavailable', () =>
    {
        (globalThis as any).api = {}
        expect(() => new IpcAccountService()).toThrow(/account is unavailable/)
    })

    it('updates State and raises Changed once per push', () =>
    {
        const { Bridge, Service } = Make()
        let count = 0
        Service.Changed.subscribe(() => { count++ })
        Bridge.Listener!({ SignedIn: true, Email: 'a@b.c' })
        expect(Service.State).toEqual({ SignedIn: true, Email: 'a@b.c' })
        expect(count).toBe(1)
    })

    it('Refresh loads the state and raises Changed', async () =>
    {
        const bridge = new FakeAccountBridge()
        bridge.Reply = { Ok: true, Value: { SignedIn: true, Email: 'x@y.z' } }
        const { Service } = Make(bridge)
        let count = 0
        Service.Changed.subscribe(() => { count++ })
        await Service.Refresh()
        expect(Service.State.Email).toBe('x@y.z')
        expect(count).toBe(1)
    })

    it('forwards calls to the bridge', async () =>
    {
        const { Bridge, Service } = Make()
        expect(await Service.Discover('p', 'e')).toEqual([{ Id: 't', DisplayName: 'T' }])
        await Service.SignIn('p', 'e', 't')
        await Service.CancelSignIn()
        expect(await Service.LastChoice('contribute' as any)).toEqual({ Environment: 'e' })
        await Service.RememberChoice('publish' as any, { Environment: 'z' })
        expect(Bridge.Calls).toEqual([
            ['Discover', 'p', 'e'], ['SignIn', 'p', 'e', 't'], ['Cancel'],
            ['LastChoice', 'contribute'], ['Remember', 'publish', { Environment: 'z' }],
        ])
    })

    it('keeps the AccountError kind from a failed reply', async () =>
    {
        const bridge = new FakeAccountBridge()
        bridge.Reply = { Ok: false, Error: { Kind: AccountErrorKind.TimedOut } }
        const { Service } = Make(bridge)
        const error = await Service.SignIn('p', 'e', 't').catch((e) => e)
        expect(error).toBeInstanceOf(AccountError)
        expect(error.Kind).toBe(AccountErrorKind.TimedOut)
    })

    it('raises Changed once for a sign-in reply plus its push', async () =>
    {
        const bridge = new FakeAccountBridge()
        bridge.Reply = { Ok: true, Value: { SignedIn: true, Email: 'a@b.c', TenantName: 'T' } }
        const { Service } = Make(bridge)
        let count = 0
        Service.Changed.subscribe(() => { count++ })
        await Service.SignIn('p', 'e', 't')
        bridge.Listener!({ SignedIn: true, Email: 'a@b.c', TenantName: 'T' })
        expect(count).toBe(1)
    })

    it('dispose releases the account:changed subscription', () =>
    {
        const { Bridge, Service } = Make()
        Service.dispose()
        expect(Bridge.Disposed).toBe(true)
    })

    it('RequestSignIn raises SignInRequested', () =>
    {
        const { Service } = Make()
        let count = 0
        Service.SignInRequested.subscribe(() => { count++ })
        Service.RequestSignIn()
        expect(count).toBe(1)
    })
})
