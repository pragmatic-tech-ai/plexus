import { describe, expect, it, vi } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { AccountServiceKey } from '@pragmatic-tech-ai/plexus-core/renderer/modules/account'
import { AccountDialog } from '../account-dialog.js'
import { AccountDialogHost } from '../account-dialog-host.js'
import { AccountSignInModule } from '../account-sign-in-module.js'
import { AccountStatusItem } from '../account-status-item.js'
import { AccountShellHarness } from './account-shell-harness.js'
import { Deferred, FakeAccountService } from './fake-account-service.js'

describe('AccountSignInModule', () =>
{
    it('answers a picker sign-in request from module load, with no status-bar cell ever built', async () =>
    {
        const h = new AccountShellHarness()
        AccountSignInModule.RegisterServices(h.Provider)
        const done = h.Account.RequestSignIn()
        expect(h.Dialogs.Shown).toHaveLength(1)
        expect(h.Dialogs.Shown[0].Content).toBeInstanceOf(AccountDialog)
        h.Account.SetState({ SignedIn: true, Email: 'ada@acme.test', TenantName: 'Acme' })
        h.Dialogs.Pending.Resolve(undefined)
        await expect(done).resolves.toBe(true)
    })

    it('loads the account state once at module load', () =>
    {
        const h = new AccountShellHarness()
        AccountSignInModule.RegisterServices(h.Provider)
        expect(h.Account.RefreshCount).toBe(1)
    })

    it('registers one host that the status cell shares: a request while the cell has the dialog open resolves false', async () =>
    {
        const h = new AccountShellHarness()
        AccountSignInModule.RegisterServices(h.Provider)
        const host = h.Provider.getRequired(AccountDialogHost.Key)
        new AccountStatusItem(h.Provider).OpenCommand.Execute()
        expect(h.Provider.getRequired(AccountDialogHost.Key)).toBe(host)
        await expect(h.Account.RequestSignIn()).resolves.toBe(false)
        expect(h.Dialogs.Shown).toHaveLength(1)
    })
})

describe('AccountDialogHost', () =>
{
    it('the dialog reads the console address setting', async () =>
    {
        const h = new AccountShellHarness()
        h.Settings.Values.set('account.consoleAddress', 'https://c.example')
        const host = new AccountDialogHost(h.Provider)
        h.Account.RequestSignIn()
        expect(host.CurrentDialog?.ConsoleAddress).toBe('https://c.example')
    })

    it('exposes the open dialog as CurrentDialog while it is shown, and clears it on close', async () =>
    {
        const h = new AccountShellHarness()
        const host = new AccountDialogHost(h.Provider)
        expect(host.CurrentDialog).toBeUndefined()
        h.Account.RequestSignIn()
        expect(host.CurrentDialog).toBe(h.Dialogs.Shown[0].Content)
        h.Dialogs.Pending.Resolve(undefined)
        await AccountShellHarness.Flush()
        expect(host.CurrentDialog).toBeUndefined()
    })

    it('opens the dialog when some UI requests sign-in, once while it is open', async () =>
    {
        const h = new AccountShellHarness()
        new AccountDialogHost(h.Provider)
        h.Account.RequestSignIn()
        h.Account.RequestSignIn()
        expect(h.Dialogs.Shown).toHaveLength(1)
        expect(h.Dialogs.Shown[0].Content).toBeInstanceOf(AccountDialog)
        h.Dialogs.Pending.Resolve(undefined)
        await AccountShellHarness.Flush()
        h.Dialogs.Pending = new Deferred<unknown>()
        h.Account.RequestSignIn()
        expect(h.Dialogs.Shown).toHaveLength(2)
    })

    it('a sign-in request resolves false when the dialog closes signed out', async () =>
    {
        const h = new AccountShellHarness()
        new AccountDialogHost(h.Provider)
        const done = h.Account.RequestSignIn()
        h.Dialogs.Pending.Resolve(undefined)
        await expect(done).resolves.toBe(false)
    })

    it('a dialog opened for a request closes itself once its sign-in succeeds, and the request resolves true', async () =>
    {
        const h = new AccountShellHarness()
        h.Account.Tenants = [{ Id: 't1', DisplayName: 'Acme' }]
        h.Account.SignInGate.Resolve()
        new AccountDialogHost(h.Provider)
        const done = h.Account.RequestSignIn()
        const vm = h.Dialogs.Shown[0].Content as AccountDialog
        vm.Email = 'ada@acme.test'
        await vm.Continue()
        expect(h.Dialogs.CloseCount).toBe(1)
        await expect(done).resolves.toBe(true)
    })

    it('a dialog opened by OpenDialog() without a request stays open after its sign-in', async () =>
    {
        const h = new AccountShellHarness()
        h.Account.Tenants = [{ Id: 't1', DisplayName: 'Acme' }]
        h.Account.SignInGate.Resolve()
        void new AccountDialogHost(h.Provider).OpenDialog()
        const vm = h.Dialogs.Shown[0].Content as AccountDialog
        vm.Email = 'ada@acme.test'
        await vm.Continue()
        expect(vm.IsSignedInStep).toBe(true)
        expect(h.Dialogs.CloseCount).toBe(0)
    })

    it('a sign-in request completes (false) and the failure logs only its name when the dialog cannot be built', async () =>
    {
        const h = new AccountShellHarness()
        new AccountDialogHost(h.Provider)
        // The AccountDialog subscribes to Changed in its constructor; make that throw.
        h.Account.Changed.subscribe = () => { throw new TypeError('secret http://x token=abc') }
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        try
        {
            await expect(h.Account.RequestSignIn()).resolves.toBe(false)
            await AccountShellHarness.Flush()
            expect(h.Dialogs.Shown).toHaveLength(0)
            const logged = warn.mock.calls.map((c) => c.join(' ')).join('\n')
            expect(logged).toContain('TypeError')
            expect(logged).not.toContain('secret')
        }
        finally
        {
            warn.mockRestore()
        }
    })

    it('a sign-in request with no DialogService resolves false', async () =>
    {
        const account = new FakeAccountService()
        const provider = new ServiceProvider()
        provider.registerInstance(AccountServiceKey, account)
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        try
        {
            new AccountDialogHost(provider)
            await expect(account.RequestSignIn()).resolves.toBe(false)
        }
        finally
        {
            warn.mockRestore()
        }
    })

    it('a failed launch refresh logs only the error name', async () =>
    {
        const h = new AccountShellHarness()
        h.Account.Refresh = async () => { throw new TypeError('secret http://10.0.0.5 token=abc') }
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        try
        {
            new AccountDialogHost(h.Provider)
            await AccountShellHarness.Flush()
            expect(warn).toHaveBeenCalledTimes(1)
            const logged = warn.mock.calls[0].map(String).join(' ')
            expect(logged).toContain('TypeError')
            expect(logged).not.toContain('secret')
        }
        finally
        {
            warn.mockRestore()
        }
    })

    it('dispose stops answering sign-in requests', async () =>
    {
        const h = new AccountShellHarness()
        new AccountDialogHost(h.Provider).dispose()
        await expect(h.Account.RequestSignIn()).resolves.toBe(false)
        expect(h.Dialogs.Shown).toHaveLength(0)
    })
})
