import { describe, expect, it } from 'vitest'
import { PlatformAddress } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { AccountStatusItem } from '../account-status-item.js'
import { AccountDialog } from '../account-dialog.js'
import { AccountSignInModule } from '../account-sign-in-module.js'
import { AccountShellHarness } from './account-shell-harness.js'

class Harness extends AccountShellHarness
{
    public constructor()
    {
        super()
        AccountSignInModule.RegisterServices(this.Provider)
    }

    public Make(): AccountStatusItem
    {
        return new AccountStatusItem(this.Provider)
    }
}

describe('AccountStatusItem', () =>
{
    it('reads "Sign in" when signed out', () =>
    {
        const h = new Harness()
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
        h.Make().OpenCommand.Execute()
        const vm = h.Dialogs.Shown[0].Content as AccountDialog
        vm.Email = 'ada@acme.test'
        await vm.Continue()
        expect(h.Account.Calls[0]).toEqual(['Discover', PlatformAddress.Default, 'ada@acme.test'])
    })

    it('a status-bar sign-in keeps the dialog open on "Signed in as"', async () =>
    {
        const h = new Harness()
        h.Account.Tenants = [{ Id: 't', DisplayName: 'T' }]
        h.Account.SignInGate.Resolve()
        h.Make().OpenCommand.Execute()
        const vm = h.Dialogs.Shown[0].Content as AccountDialog
        vm.Email = 'ada@acme.test'
        await vm.Continue()
        expect(vm.IsSignedInStep).toBe(true)
        expect(h.Dialogs.CloseCount).toBe(0)
    })

    it('a sign-in request while the cell opened the dialog resolves false at once', async () =>
    {
        const h = new Harness()
        h.Make().OpenCommand.Execute()
        await expect(h.Account.RequestSignIn()).resolves.toBe(false)
        expect(h.Dialogs.Shown).toHaveLength(1)
    })

    it('the dialog closes through DialogService', async () =>
    {
        const h = new Harness()
        h.Make().OpenCommand.Execute()
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
        expect(item.Text).toBe('Sign in')
    })
})
