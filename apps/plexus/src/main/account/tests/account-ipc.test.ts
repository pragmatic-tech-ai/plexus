import { describe, it, expect, vi, afterEach } from 'vitest'
import type { IpcMain } from 'electron'
import { Signal } from '@pragmatic-tech-ai/todl-runtime'
import {
    AccountChannel, AccountError, AccountErrorKind, PlatformAccess, TargetKind, TargetSource,
    type AccountState, type AccountTargets, type DiscoveredTenant, type TargetChoice,
} from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { AccountIpc, type IAccountChangeSink } from '../account-ipc.js'
import type { AccountService } from '../account-service.js'

type Handler = (event: unknown, ...args: unknown[]) => unknown

class FakeIpc
{
    public readonly Handlers = new Map<string, Handler>()

    public handle(channel: string, handler: Handler): void
    {
        this.Handlers.set(channel, handler)
    }
}

class FakeService
{
    public readonly Changed = new Signal<AccountState>()
    public readonly Calls: unknown[][] = []
    public Failure: unknown

    public async State(): Promise<AccountState> { return this.Run(['State'], { SignedIn: true, Email: 'a@b.c', TenantName: 'Acme' }) }
    public async Discover(p: string, e: string): Promise<DiscoveredTenant[]> { return this.Run(['Discover', p, e], [{ Id: 't', DisplayName: 'T' }]) }
    public async SignIn(p: string, e: string, t: string): Promise<AccountState> { return this.Run(['SignIn', p, e, t], { SignedIn: true }) }
    public async SignInAtConsole(c: string, e: string): Promise<AccountState> { return this.Run(['SignInAtConsole', c, e], { SignedIn: true }) }
    public async SignInAtPlatform(): Promise<AccountState> { return this.Run(['SignInAtPlatform'], { SignedIn: true, Platform: PlatformAccess.SignedIn }) }
    public async CancelSignIn(): Promise<void> { return this.Run(['CancelSignIn'], undefined) }
    public async SignOut(): Promise<AccountState> { return this.Run(['SignOut'], { SignedIn: false }) }
    public async Targets(): Promise<AccountTargets> { return this.Run(['Targets'], { Contribute: [], Publish: [] }) }
    public async LastChoice(k: TargetKind): Promise<TargetChoice | undefined> { return this.Run(['LastChoice', k], { Environment: 'dev' }) }
    public async RememberChoice(k: TargetKind, c: TargetChoice): Promise<void> { return this.Run(['RememberChoice', k, c], undefined) }

    private Run<T>(call: unknown[], value: T): T
    {
        this.Calls.push(call)
        if (this.Failure !== undefined) throw this.Failure
        return value
    }
}

class FakeSink implements IAccountChangeSink
{
    public readonly Sent: unknown[][] = []

    public constructor(private readonly destroyed = false, private readonly throws = false)
    {
    }

    public send(channel: string, ...args: unknown[]): void
    {
        if (this.throws) throw new Error('Render frame was disposed')
        this.Sent.push([channel, ...args])
    }
    public isDestroyed(): boolean { return this.destroyed }
}

class Harness
{
    public readonly Ipc = new FakeIpc()
    public readonly Service = new FakeService()
    public readonly Sinks = [new FakeSink(false, true), new FakeSink(), new FakeSink(true)]

    public constructor()
    {
        AccountIpc.Register(this.Ipc as unknown as IpcMain, this.Service as unknown as AccountService, () => this.Sinks)
    }

    public Invoke(channel: AccountChannel, ...args: unknown[]): unknown
    {
        return this.Ipc.Handlers.get(channel)!({}, ...args)
    }
}

describe('AccountIpc', () =>
{
    afterEach(() => vi.restoreAllMocks())

    it('binds every invoke channel (Changed is a push channel)', () =>
    {
        const h = new Harness()
        for (const channel of Object.values(AccountChannel))
        {
            expect(h.Ipc.Handlers.has(channel)).toBe(channel !== AccountChannel.Changed)
        }
    })

    it('delegates and wraps values in the reply envelope', async () =>
    {
        const h = new Harness()
        expect(await h.Invoke(AccountChannel.State)).toEqual({ Ok: true, Value: { SignedIn: true, Email: 'a@b.c', TenantName: 'Acme' } })
        expect(await h.Invoke(AccountChannel.Discover, 'http://localhost:7000', 'a@b.c')).toEqual({ Ok: true, Value: [{ Id: 't', DisplayName: 'T' }] })
        await h.Invoke(AccountChannel.SignIn, 'http://localhost:7000', 'a@b.c', 't')
        await h.Invoke(AccountChannel.CancelSignIn)
        await h.Invoke(AccountChannel.SignOut)
        await h.Invoke(AccountChannel.Targets)
        await h.Invoke(AccountChannel.LastChoice, TargetKind.Publish)
        await h.Invoke(AccountChannel.RememberChoice, TargetKind.Contribute, { Environment: 'dev', GraphName: 'g' })
        expect(h.Service.Calls).toEqual([
            ['State'],
            ['Discover', 'http://localhost:7000', 'a@b.c'],
            ['SignIn', 'http://localhost:7000', 'a@b.c', 't'],
            ['CancelSignIn'],
            ['SignOut'],
            ['Targets'],
            ['LastChoice', TargetKind.Publish],
            ['RememberChoice', TargetKind.Contribute, { Environment: 'dev', GraphName: 'g' }],
        ])
    })

    it('sign-in-at-console passes both strings and answers the state envelope', async () =>
    {
        const h = new Harness()
        expect(await h.Invoke(AccountChannel.SignInAtConsole, 'https://c.example', 'a@b.c')).toEqual({ Ok: true, Value: { SignedIn: true } })
        expect(h.Service.Calls).toEqual([['SignInAtConsole', 'https://c.example', 'a@b.c']])
    })

    it('sign-in-at-platform calls the service with no arguments and answers the state envelope', async () =>
    {
        const h = new Harness()
        expect(await h.Invoke(AccountChannel.SignInAtPlatform, 'ignored', 'extra')).toEqual({ Ok: true, Value: { SignedIn: true, Platform: PlatformAccess.SignedIn } })
        expect(h.Service.Calls).toEqual([['SignInAtPlatform']])
    })

    it('sign-in-at-platform turns a non-AccountError into Unavailable', async () =>
    {
        const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const h = new Harness()
        h.Service.Failure = new Error('boom http://secret.example')
        expect(await h.Invoke(AccountChannel.SignInAtPlatform)).toEqual({ Ok: false, Error: { Kind: AccountErrorKind.Unavailable } })
        expect(JSON.stringify(log.mock.calls)).not.toContain('secret.example')
    })

    it('a non-string console address is refused as malformed', async () =>
    {
        const h = new Harness()
        expect(await h.Invoke(AccountChannel.SignInAtConsole, 42, 'a@b.c')).toEqual({ Ok: false, Error: { Kind: AccountErrorKind.Unavailable } })
        expect(await h.Invoke(AccountChannel.SignInAtConsole, 'https://c.example', undefined)).toEqual({ Ok: false, Error: { Kind: AccountErrorKind.Unavailable } })
        expect(h.Service.Calls).toEqual([])
    })

    it('carries an AccountError as its kind only', async () =>
    {
        const h = new Harness()
        h.Service.Failure = new AccountError(AccountErrorKind.SignedOut)
        expect(await h.Invoke(AccountChannel.Targets)).toEqual({ Ok: false, Error: { Kind: AccountErrorKind.SignedOut } })
        const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        h.Service.Failure = Object.assign(new Error('ENOENT C:\\Users\\x\\desktop-session.bin'), { code: 'ENOENT' })
        expect(await h.Invoke(AccountChannel.State)).toEqual({ Ok: false, Error: { Kind: AccountErrorKind.Unavailable } })
        expect(log).toHaveBeenCalledTimes(1)
        expect(JSON.stringify(log.mock.calls)).toContain('ENOENT')
        expect(JSON.stringify(log.mock.calls)).not.toContain('desktop-session.bin')
    })

    it('refuses malformed renderer arguments without calling the service', async () =>
    {
        const h = new Harness()
        expect(await h.Invoke(AccountChannel.Discover, 42, 'a@b.c')).toEqual({ Ok: false, Error: { Kind: AccountErrorKind.Unavailable } })
        expect(await h.Invoke(AccountChannel.LastChoice, 'deploy')).toEqual({ Ok: false, Error: { Kind: AccountErrorKind.Unavailable } })
        expect(await h.Invoke(AccountChannel.RememberChoice, TargetKind.Publish, { Environment: 7 })).toEqual({ Ok: false, Error: { Kind: AccountErrorKind.Unavailable } })
        expect(h.Service.Calls).toEqual([])
    })

    it('RememberChoice passes a valid Source through and refuses an invalid one without calling the service', async () =>
    {
        const h = new Harness()
        await h.Invoke(AccountChannel.RememberChoice, TargetKind.Publish, { Environment: 'dev', Source: TargetSource.Platform })
        expect(h.Service.Calls).toEqual([['RememberChoice', TargetKind.Publish, { Environment: 'dev', Source: TargetSource.Platform }]])
        h.Service.Calls.length = 0
        expect(await h.Invoke(AccountChannel.RememberChoice, TargetKind.Publish, { Environment: 'dev', Source: 'bogus' })).toEqual({ Ok: false, Error: { Kind: AccountErrorKind.Unavailable } })
        expect(h.Service.Calls).toEqual([])
    })

    it('pushes Changed to every live renderer; a throwing window neither stops the others nor throws', () =>
    {
        const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const h = new Harness()
        expect(() => h.Service.Changed.emit({ SignedIn: false })).not.toThrow()
        expect(h.Sinks[1].Sent).toEqual([[AccountChannel.Changed, { SignedIn: false }]])
        expect(h.Sinks[2].Sent).toEqual([])
        expect(log).toHaveBeenCalledTimes(1)
        expect(JSON.stringify(log.mock.calls)).not.toContain('disposed')
    })
})
