import { describe, expect, it, vi } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ApplicationSettings, DialogService, type DialogOptions } from '@pragmatic-tech-ai/mural/framework'
import { AccountServiceKey } from '@pragmatic-tech-ai/plexus-core/renderer/modules/account'
import { PlatformAddress } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { AccountStatusItem } from '../account-status-item.js'
import { AccountDialog } from '../account-dialog.js'
import { Deferred, FakeAccountService } from './fake-account-service.js'

class FakeDialogs
{
    public readonly Shown: DialogOptions[] = []
    public Pending = new Deferred<unknown>()
    public CloseCount = 0

    public Show<T>(options: DialogOptions): Promise<T | undefined>
    {
        this.Shown.push(options)
        return this.Pending.Promise as Promise<T | undefined>
    }

    public Close(): void
    {
        this.CloseCount++
        this.Pending.Resolve(undefined)
    }
}

class FakeSettings
{
    public readonly Values = new Map<string, unknown>()

    public Get<T>(key: string): T | undefined
    {
        return this.Values.get(key) as T | undefined
    }
}

class Harness
{
    public readonly Account = new FakeAccountService()
    public readonly Dialogs = new FakeDialogs()
    public readonly Settings = new FakeSettings()
    public readonly Provider = new ServiceProvider()

    public constructor()
    {
        this.Provider.registerInstance(AccountServiceKey, this.Account)
        this.Provider.registerInstance(DialogService.Key, this.Dialogs as unknown as DialogService)
        this.Provider.registerInstance(ApplicationSettings.Key, this.Settings as unknown as ApplicationSettings)
    }

    public Make(): AccountStatusItem
    {
        return new AccountStatusItem(this.Provider)
    }

    public static async Flush(): Promise<void>
    {
        for (let i = 0; i < 5; i++) await Promise.resolve()
    }
}

describe('AccountStatusItem', () =>
{
    it('reads "Sign in" when signed out and refreshes the state on start', () =>
    {
        const h = new Harness()
        const item = h.Make()
        expect(item.Text).toBe('Sign in')
        expect(h.Account.RefreshCount).toBe(1)
    })

    it('a failed launch refresh logs only the error name', async () =>
    {
        const h = new Harness()
        h.Account.Refresh = async () => { throw new TypeError('secret http://10.0.0.5 token=abc') }
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        try
        {
            h.Make()
            await Harness.Flush()
            expect(warn).toHaveBeenCalledTimes(1)
            const logged = warn.mock.calls[0].map(String).join(' ')
            expect(logged).toContain('TypeError')
            expect(logged).not.toContain('secret')
        }
        finally
        {
            warn.mockRestore()
        }
        expect(h.Make().Text).toBe('Sign in')
    })

    it('Text follows Changed', () =>
    {
        const h = new Harness()
        const item = h.Make()
        let raised = 0
        item.PropertyChanged('Text').subscribe(() => { raised++ })
        h.Account.SetState({ SignedIn: true, Email: 'ada@acme.test', TenantName: 'Acme' })
        expect(item.Text).toBe('ada@acme.test (Acme)')
        expect(raised).toBe(1)
        h.Account.SetState({ SignedIn: false })
        expect(item.Text).toBe('Sign in')
        expect(raised).toBe(2)
    })

    it('OpenCommand opens the account dialog with the Platform address setting', async () =>
    {
        const h = new Harness()
        h.Settings.Values.set('account.platformAddress', 'https://platform.example.com')
        h.Account.Tenants = [{ Id: 't', DisplayName: 'T' }, { Id: 'u', DisplayName: 'U' }]
        const item = h.Make()
        item.OpenCommand.Execute()
        expect(h.Dialogs.Shown).toHaveLength(1)
        const vm = h.Dialogs.Shown[0].Content as AccountDialog
        expect(vm).toBeInstanceOf(AccountDialog)
        expect(h.Dialogs.Shown[0].Title).toBe('Account')
        vm.Email = 'ada@acme.test'
        await vm.Continue()
        expect(h.Account.Calls[0]).toEqual(['Discover', 'https://platform.example.com', 'ada@acme.test'])
    })

    it('falls back to the default Platform address when the setting is unset', async () =>
    {
        const h = new Harness()
        h.Account.Tenants = [{ Id: 't', DisplayName: 'T' }, { Id: 'u', DisplayName: 'U' }]
        const item = h.Make()
        item.OpenCommand.Execute()
        const vm = h.Dialogs.Shown[0].Content as AccountDialog
        vm.Email = 'ada@acme.test'
        await vm.Continue()
        expect(h.Account.Calls[0]).toEqual(['Discover', PlatformAddress.Default, 'ada@acme.test'])
    })

    it('opens the dialog when some UI requests sign-in, once while it is open', async () =>
    {
        const h = new Harness()
        h.Make()
        h.Account.RequestSignIn()
        h.Account.RequestSignIn()
        expect(h.Dialogs.Shown).toHaveLength(1)
        expect(h.Dialogs.Shown[0].Content).toBeInstanceOf(AccountDialog)
        h.Dialogs.Pending.Resolve(undefined)
        await Harness.Flush()
        h.Dialogs.Pending = new Deferred<unknown>()
        h.Account.RequestSignIn()
        expect(h.Dialogs.Shown).toHaveLength(2)
    })

    it('a sign-in request resolves true when the dialog closes signed in', async () =>
    {
        const h = new Harness()
        h.Make()
        const done = h.Account.RequestSignIn()
        expect(h.Dialogs.Shown).toHaveLength(1)
        h.Account.SetState({ SignedIn: true, Email: 'ada@acme.test', TenantName: 'Acme' })
        h.Dialogs.Pending.Resolve(undefined)
        await expect(done).resolves.toBe(true)
    })

    it('a sign-in request resolves false when the dialog closes signed out', async () =>
    {
        const h = new Harness()
        h.Make()
        const done = h.Account.RequestSignIn()
        h.Dialogs.Pending.Resolve(undefined)
        await expect(done).resolves.toBe(false)
    })

    it('a sign-in request while the dialog is already open resolves false at once', async () =>
    {
        const h = new Harness()
        const item = h.Make()
        item.OpenCommand.Execute()
        await expect(h.Account.RequestSignIn()).resolves.toBe(false)
        expect(h.Dialogs.Shown).toHaveLength(1)
    })

    it('a sign-in request with no DialogService resolves false', async () =>
    {
        const h = new Harness()
        const provider = new ServiceProvider()
        provider.registerInstance(AccountServiceKey, h.Account)
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        new AccountStatusItem(provider)
        await expect(h.Account.RequestSignIn()).resolves.toBe(false)
        warn.mockRestore()
    })

    it('the dialog closes through DialogService', async () =>
    {
        const h = new Harness()
        const item = h.Make()
        item.OpenCommand.Execute()
        const vm = h.Dialogs.Shown[0].Content as AccountDialog
        await vm.Cancel()
        expect(h.Dialogs.CloseCount).toBe(1)
    })

    it('dispose stops following the account', () =>
    {
        const h = new Harness()
        const item = h.Make()
        item.dispose()
        h.Account.SetState({ SignedIn: true, Email: 'ada@acme.test', TenantName: 'Acme' })
        h.Account.RequestSignIn()
        expect(item.Text).toBe('Sign in')
        expect(h.Dialogs.Shown).toHaveLength(0)
    })
})
