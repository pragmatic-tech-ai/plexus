import { describe, expect, it } from 'vitest'
import { AccountError, AccountErrorKind, PlatformAddress } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { AccountDialog, AccountDialogStep } from '../account-dialog.js'
import { FakeAccountService } from './fake-account-service.js'

class Harness
{
    public readonly Account = new FakeAccountService()
    public Closed = 0

    public Make(address: string = PlatformAddress.Default): AccountDialog
    {
        return new AccountDialog(this.Account, address, () => { this.Closed++ })
    }

    // Lets queued promise continuations run.
    public static async Flush(): Promise<void>
    {
        for (let i = 0; i < 5; i++) await Promise.resolve()
    }
}

describe('AccountDialog', () =>
{
    it('starts on the Email step when signed out', () =>
    {
        const vm = new Harness().Make()
        expect(vm.Step).toBe(AccountDialogStep.Email)
        expect(vm.IsEmailStep).toBe(true)
        expect(vm.Message).toBe('')
        expect(vm.IsBusy).toBe(false)
    })

    it('single tenant goes Email -> Waiting -> SignedIn', async () =>
    {
        const h = new Harness()
        h.Account.Tenants = [{ Id: 't1', DisplayName: 'Acme' }]
        const vm = h.Make()
        vm.Email = '  ada@acme.test '
        const continued = vm.Continue()
        await Harness.Flush()
        expect(vm.Step).toBe(AccountDialogStep.Waiting)
        expect(vm.IsWaitingStep).toBe(true)
        expect(h.Account.Calls).toEqual([
            ['Discover', PlatformAddress.Default, 'ada@acme.test'],
            ['SignIn', PlatformAddress.Default, 'ada@acme.test', 't1'],
        ])
        h.Account.SignInGate.Resolve()
        await continued
        expect(vm.Step).toBe(AccountDialogStep.SignedIn)
        expect(vm.IsSignedInStep).toBe(true)
        expect(vm.SignedInText).toBe('Signed in as ada@acme.test (Acme)')
        expect(vm.Message).toBe('')
    })

    it('several tenants stop at ChooseTenant with names sorted, then sign in to the choice', async () =>
    {
        const h = new Harness()
        h.Account.Tenants = [
            { Id: 'z', DisplayName: 'Zeta' },
            { Id: 'a', DisplayName: 'Alpha' },
            { Id: 'm', DisplayName: 'Mid' },
        ]
        const vm = h.Make()
        vm.Email = 'ada@acme.test'
        await vm.Continue()
        expect(vm.Step).toBe(AccountDialogStep.ChooseTenant)
        expect(vm.IsChooseTenantStep).toBe(true)
        expect(vm.Tenants.map((t) => t.DisplayName)).toEqual(['Alpha', 'Mid', 'Zeta'])
        expect(vm.Tenants.map((t) => String(t))).toEqual(['Alpha', 'Mid', 'Zeta'])
        expect(vm.SelectedTenant?.DisplayName).toBe('Alpha')
        expect(h.Account.CallNames()).toEqual(['Discover'])

        vm.SelectedTenant = vm.Tenants[2]
        const continued = vm.Continue()
        await Harness.Flush()
        expect(vm.Step).toBe(AccountDialogStep.Waiting)
        expect(h.Account.Calls[1]).toEqual(['SignIn', PlatformAddress.Default, 'ada@acme.test', 'z'])
        h.Account.SignInGate.Resolve()
        await continued
        expect(vm.SignedInText).toBe('Signed in as ada@acme.test (Zeta)')
    })

    it('NoAccount shows its sentence and stays on Email', async () =>
    {
        const h = new Harness()
        h.Account.DiscoverError = new AccountError(AccountErrorKind.NoAccount)
        const vm = h.Make()
        vm.Email = 'nobody@acme.test'
        await vm.Continue()
        expect(vm.Step).toBe(AccountDialogStep.Email)
        expect(vm.Message).toBe('No account was found for this email.')
        expect(vm.HasMessage).toBe(true)
        expect(vm.IsBusy).toBe(false)
    })

    it('an empty discovery reads as NoAccount', async () =>
    {
        const h = new Harness()
        const vm = h.Make()
        vm.Email = 'nobody@acme.test'
        await vm.Continue()
        expect(vm.Step).toBe(AccountDialogStep.Email)
        expect(vm.Message).toBe('No account was found for this email.')
    })

    it('a non-account failure shows a fixed sentence, never its own text', async () =>
    {
        const h = new Harness()
        h.Account.DiscoverError = new Error('ECONNREFUSED 10.0.0.5:7000 secret-path')
        const vm = h.Make()
        vm.Email = 'ada@acme.test'
        await vm.Continue()
        expect(vm.Step).toBe(AccountDialogStep.Email)
        expect(vm.Message).toBe('Something went wrong. Try again.')
    })

    it('an invalid Platform address shows the Validate sentence without calling main', async () =>
    {
        const h = new Harness()
        const vm = h.Make('http://platform.example.com')
        vm.Email = 'ada@acme.test'
        await vm.Continue()
        expect(vm.Step).toBe(AccountDialogStep.Email)
        expect(vm.Message).toBe(PlatformAddress.Validate('http://platform.example.com'))
        expect(h.Account.Calls).toEqual([])
    })

    it('Cancel while waiting cancels the sign-in and returns to Email', async () =>
    {
        const h = new Harness()
        h.Account.Tenants = [{ Id: 't1', DisplayName: 'Acme' }]
        const vm = h.Make()
        vm.Email = 'ada@acme.test'
        const continued = vm.Continue()
        await Harness.Flush()
        expect(vm.Step).toBe(AccountDialogStep.Waiting)
        await vm.Cancel()
        expect(h.Account.CallNames()).toContain('CancelSignIn')
        expect(vm.Step).toBe(AccountDialogStep.Email)
        expect(h.Closed).toBe(0)
        // The pending sign-in then fails as cancelled; the dialog stays on Email.
        h.Account.SignInGate.Reject(new AccountError(AccountErrorKind.Cancelled))
        await continued
        expect(vm.Step).toBe(AccountDialogStep.Email)
        expect(vm.IsBusy).toBe(false)
    })

    it('a failed sign-in shows its sentence and returns to Email', async () =>
    {
        const h = new Harness()
        h.Account.Tenants = [{ Id: 't1', DisplayName: 'Acme' }]
        const vm = h.Make()
        vm.Email = 'ada@acme.test'
        const continued = vm.Continue()
        await Harness.Flush()
        h.Account.SignInGate.Reject(new AccountError(AccountErrorKind.TimedOut))
        await continued
        expect(vm.Step).toBe(AccountDialogStep.Email)
        expect(vm.Message).toBe('Sign-in was not finished in the browser. Try again.')
    })

    it('Cancel outside waiting closes the dialog', async () =>
    {
        const h = new Harness()
        const vm = h.Make()
        await vm.Cancel()
        expect(h.Closed).toBe(1)
        expect(h.Account.Calls).toEqual([])
    })

    it('opens on SignedIn when already signed in and signs out back to Email', async () =>
    {
        const h = new Harness()
        h.Account.SetState({ SignedIn: true, Email: 'ada@acme.test', TenantName: 'Acme' })
        const vm = h.Make()
        expect(vm.Step).toBe(AccountDialogStep.SignedIn)
        expect(vm.SignedInText).toBe('Signed in as ada@acme.test (Acme)')
        await vm.SignOut()
        expect(h.Account.CallNames()).toEqual(['SignOut'])
        expect(vm.Step).toBe(AccountDialogStep.Email)
    })

    it('raises PropertyChanged for Step and its flags across a single-tenant flow', async () =>
    {
        const h = new Harness()
        h.Account.Tenants = [{ Id: 't1', DisplayName: 'Acme' }]
        const vm = h.Make()
        const seen: Array<[string, unknown]> = []
        for (const name of ['Step', 'IsEmailStep', 'IsWaitingStep', 'IsSignedInStep', 'IsChooseTenantStep'])
        {
            vm.PropertyChanged(name).subscribe((e) => { seen.push([name, e.newValue]) })
        }
        vm.Email = 'ada@acme.test'
        const continued = vm.Continue()
        await Harness.Flush()
        expect(seen).toEqual([
            ['Step', AccountDialogStep.Waiting],
            ['IsEmailStep', false],
            ['IsChooseTenantStep', false],
            ['IsWaitingStep', true],
            ['IsSignedInStep', false],
        ])
        seen.length = 0
        h.Account.SignInGate.Resolve()
        await continued
        expect(seen).toEqual([
            ['Step', AccountDialogStep.SignedIn],
            ['IsEmailStep', false],
            ['IsChooseTenantStep', false],
            ['IsWaitingStep', false],
            ['IsSignedInStep', true],
        ])
    })

    it('a sign-in from elsewhere moves to SignedIn and clears the message', async () =>
    {
        const h = new Harness()
        h.Account.DiscoverError = new AccountError(AccountErrorKind.NoAccount)
        const vm = h.Make()
        vm.Email = 'ada@acme.test'
        await vm.Continue()
        expect(vm.HasMessage).toBe(true)
        h.Account.SetState({ SignedIn: true, Email: 'ada@acme.test', TenantName: 'Acme' })
        expect(vm.Step).toBe(AccountDialogStep.SignedIn)
        expect(vm.Message).toBe('')
        expect(vm.HasMessage).toBe(false)
    })

    it('raises PropertyChanged for Message, HasMessage and IsBusy', async () =>
    {
        const h = new Harness()
        h.Account.DiscoverError = new AccountError(AccountErrorKind.InvalidEmail)
        const vm = h.Make()
        const seen: string[] = []
        for (const name of ['Message', 'HasMessage', 'IsBusy'])
        {
            vm.PropertyChanged(name).subscribe(() => { seen.push(name) })
        }
        vm.Email = 'nope'
        await vm.Continue()
        expect(seen).toContain('Message')
        expect(seen).toContain('HasMessage')
        expect(seen).toContain('IsBusy')
        expect(vm.Message).toBe("That doesn't look like an email address.")
    })

    it('a discovery answering after the dialog closed starts no sign-in', async () =>
    {
        const h = new Harness()
        h.Account.Tenants = [{ Id: 't1', DisplayName: 'Acme' }]
        const vm = h.Make()
        vm.Email = 'ada@acme.test'
        const continued = vm.Continue()
        vm.dispose()
        await continued
        expect(h.Account.CallNames()).toEqual(['Discover'])
    })

    it('dispose while waiting cancels the pending sign-in', async () =>
    {
        const h = new Harness()
        h.Account.Tenants = [{ Id: 't1', DisplayName: 'Acme' }]
        const vm = h.Make()
        vm.Email = 'ada@acme.test'
        void vm.Continue()
        await Harness.Flush()
        vm.dispose()
        await Harness.Flush()
        expect(h.Account.CallNames()).toContain('CancelSignIn')
    })
})
