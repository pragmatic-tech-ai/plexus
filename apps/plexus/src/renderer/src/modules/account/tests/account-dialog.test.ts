import { describe, expect, it, vi } from 'vitest'
import {
    AccountError, AccountErrorKind, PlatformAccess, PlatformAddress,
} from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { AccountDialog, AccountDialogStep } from '../account-dialog.js'
import { Deferred, FakeAccountService } from './fake-account-service.js'
import type { IConsoleAddressSetting } from '../console-address-setting.js'

class FakeConsoleSetting implements IConsoleAddressSetting
{
    public Value = ''
    public Remembered: string[] = []
    public ForgetCount = 0

    public Remember(address: string): void
    {
        this.Remembered.push(address)
    }

    public Forget(): void
    {
        this.ForgetCount++
    }
}

class Harness
{
    public readonly Account = new FakeAccountService()
    public Closed = 0
    public readonly Setting = new FakeConsoleSetting()

    public Make(address: string = PlatformAddress.Default, closeOnSignIn = false): AccountDialog
    {
        return new AccountDialog(this.Account, address, this.Setting, () => { this.Closed++ }, closeOnSignIn)
    }

    // A harness whose discovery sign-in (one tenant, settled) reports the platform as Offered.
    public static Offered(): Harness
    {
        const h = new Harness()
        h.Account.Tenants = [{ Id: 't1', DisplayName: 'Acme' }]
        h.Account.SignInPlatform = PlatformAccess.Offered
        h.Account.SignInGate.Resolve()
        return h
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

    it('stays open on SignedIn after its sign-in by default (a status-bar sign-in)', async () =>
    {
        const h = new Harness()
        h.Account.Tenants = [{ Id: 't1', DisplayName: 'Acme' }]
        h.Account.SignInGate.Resolve()
        const vm = h.Make()
        vm.Email = 'ada@acme.test'
        await vm.Continue()
        expect(vm.Step).toBe(AccountDialogStep.SignedIn)
        expect(h.Closed).toBe(0)
    })

    it('closes itself once its sign-in succeeds when opened for a sign-in request', async () =>
    {
        const h = new Harness()
        h.Account.Tenants = [{ Id: 't1', DisplayName: 'Acme' }]
        const vm = h.Make(PlatformAddress.Default, true)
        vm.Email = 'ada@acme.test'
        const continued = vm.Continue()
        await Harness.Flush()
        expect(h.Closed).toBe(0)
        h.Account.SignInGate.Resolve()
        await continued
        expect(h.Closed).toBe(1)
    })

    it('opened for a sign-in request, a failed sign-in keeps the dialog open with its sentence', async () =>
    {
        const h = new Harness()
        h.Account.Tenants = [{ Id: 't1', DisplayName: 'Acme' }]
        const vm = h.Make(PlatformAddress.Default, true)
        vm.Email = 'ada@acme.test'
        const continued = vm.Continue()
        await Harness.Flush()
        h.Account.SignInGate.Reject(new AccountError(AccountErrorKind.TimedOut))
        await continued
        expect(h.Closed).toBe(0)
        expect(vm.Step).toBe(AccountDialogStep.Email)
        expect(vm.Message).toBe(new AccountError(AccountErrorKind.TimedOut).message)
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

    describe('console address', () =>
    {
        it('the console address field starts open with the remembered address', () =>
        {
            const h = new Harness()
            h.Setting.Value = 'https://console-acme.localtest.me'
            const vm = h.Make()
            expect(vm.UseConsoleAddress).toBe(true)
            expect(vm.ShowsUseConsoleLink).toBe(false)
            expect(vm.ConsoleAddress).toBe('https://console-acme.localtest.me')
        })

        it('the commands toggle the field', () =>
        {
            const vm = new Harness().Make()
            expect(vm.UseConsoleAddress).toBe(false)
            vm.UseConsoleAddressCommand.Execute()
            expect(vm.UseConsoleAddress).toBe(true)
            vm.UsePlatformCommand.Execute()
            expect(vm.UseConsoleAddress).toBe(false)
            expect(vm.ShowsUseConsoleLink).toBe(true)
        })

        it('continue with a console address signs in there and remembers it', async () =>
        {
            const h = new Harness()
            h.Account.Tenants = [{ Id: 't1', DisplayName: 'Acme' }]
            h.Account.SignInGate.Resolve()
            const vm = h.Make()
            vm.UseConsoleAddressCommand.Execute()
            vm.Email = 'ann@acme.example'
            vm.ConsoleAddress = 'https://Console-Acme.localtest.me/'
            await vm.Continue()
            expect(h.Account.Calls).toEqual([['SignInAtConsole', 'https://Console-Acme.localtest.me/', 'ann@acme.example']])
            expect(vm.Step).toBe(AccountDialogStep.SignedIn)
            expect(h.Setting.Remembered).toEqual(['https://console-acme.localtest.me'])
            expect(h.Account.CallNames()).not.toContain('Discover')
        })

        it('raises PropertyChanged for the console address members', () =>
        {
            const vm = new Harness().Make()
            const seen: string[] = []
            for (const name of ['UseConsoleAddress', 'ShowsUseConsoleLink', 'ConsoleAddress'])
            {
                vm.PropertyChanged(name).subscribe(() => { seen.push(name) })
            }
            vm.UseConsoleAddressCommand.Execute()
            expect(seen).toEqual(['UseConsoleAddress', 'ShowsUseConsoleLink'])
            vm.ConsoleAddress = 'https://x.example'
            expect(seen).toContain('ConsoleAddress')
            seen.length = 0
            vm.UsePlatformCommand.Execute()
            expect(seen).toEqual(['UseConsoleAddress', 'ShowsUseConsoleLink'])
        })

        it('a failure to remember the address still ends on SignedIn', async () =>
        {
            const h = new Harness()
            h.Account.SignInGate.Resolve()
            h.Setting.Remember = () => { throw new Error('disk full') }
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            const vm = h.Make()
            vm.UseConsoleAddressCommand.Execute()
            vm.Email = 'ann@acme.example'
            vm.ConsoleAddress = 'https://console-acme.localtest.me'
            await vm.Continue()
            warn.mockRestore()
            expect(vm.Step).toBe(AccountDialogStep.SignedIn)
            expect(vm.Message).toBe('')
        })

        it('an invalid console address shows the sentence and calls nothing', async () =>
        {
            const h = new Harness()
            const vm = h.Make()
            vm.UseConsoleAddressCommand.Execute()
            vm.Email = 'ann@acme.example'
            vm.ConsoleAddress = 'http://console-acme.localtest.me'
            await vm.Continue()
            expect(vm.Message).toBe(new AccountError(AccountErrorKind.ConsoleAddressInvalid).message)
            expect(h.Account.Calls).toEqual([])
            expect(vm.Step).toBe(AccountDialogStep.Email)
        })

        it('a console sign-in failure shows its sentence and remembers nothing', async () =>
        {
            const h = new Harness()
            h.Account.SignInGate.Reject(new AccountError(AccountErrorKind.NotAConsole))
            const vm = h.Make()
            vm.UseConsoleAddressCommand.Execute()
            vm.Email = 'ann@acme.example'
            vm.ConsoleAddress = 'https://console-acme.localtest.me'
            await vm.Continue()
            expect(vm.Message).toBe('That address is not a Pragmatic tenant console.')
            expect(new AccountError(AccountErrorKind.NotAConsole).message).toBe('That address is not a Pragmatic tenant console.')
            expect(vm.Step).toBe(AccountDialogStep.Email)
            expect(h.Setting.Remembered).toEqual([])
        })

        it('a platform sign-in forgets the remembered console address', async () =>
        {
            const h = new Harness()
            h.Setting.Value = 'https://console-acme.localtest.me'
            h.Account.Tenants = [{ Id: 't1', DisplayName: 'Acme' }]
            h.Account.SignInGate.Resolve()
            const vm = h.Make()
            vm.UsePlatformCommand.Execute()
            vm.Email = 'ann@acme.example'
            await vm.Continue()
            expect(vm.Step).toBe(AccountDialogStep.SignedIn)
            expect(h.Setting.ForgetCount).toBe(1)
        })
    })

    describe('platform step', () =>
    {
        it('an offered sign-in lands on PlatformOffer', async () =>
        {
            const h = Harness.Offered()
            const vm = h.Make()
            vm.Email = 'ada@acme.test'
            await vm.Continue()
            expect(vm.Step).toBe(AccountDialogStep.PlatformOffer)
            expect(vm.IsPlatformOfferStep).toBe(true)
            expect(vm.IsSignedInStep).toBe(false)
            expect(vm.ShowsPlatformOffer).toBe(false)
            expect(h.Closed).toBe(0)
        })

        it('an offered sign-in does not close even when opened for a sign-in request', async () =>
        {
            const h = Harness.Offered()
            const vm = h.Make(PlatformAddress.Default, true)
            vm.Email = 'ada@acme.test'
            await vm.Continue()
            expect(vm.Step).toBe(AccountDialogStep.PlatformOffer)
            expect(h.Closed).toBe(0)
        })

        it('PlatformSignInCommand signs in at the platform once and ends on SignedIn', async () =>
        {
            const h = Harness.Offered()
            h.Account.PlatformGate = new Deferred<void>()
            const vm = h.Make()
            vm.Email = 'ada@acme.test'
            await vm.Continue()
            vm.PlatformSignInCommand.Execute()
            await Harness.Flush()
            expect(vm.Step).toBe(AccountDialogStep.Waiting)
            expect(vm.IsBusy).toBe(true)
            h.Account.PlatformGate.Resolve()
            await Harness.Flush()
            expect(h.Account.CallNames().filter((n) => n === 'SignInAtPlatform')).toHaveLength(1)
            expect(vm.Step).toBe(AccountDialogStep.SignedIn)
            expect(vm.ShowsPlatformSignedIn).toBe(true)
            expect(vm.ShowsPlatformOffer).toBe(false)
            expect(vm.IsBusy).toBe(false)
            expect(vm.Message).toBe('')
            expect(h.Closed).toBe(0)
        })

        it('opened for a sign-in request, the platform sign-in closes the dialog', async () =>
        {
            const h = Harness.Offered()
            const vm = h.Make(PlatformAddress.Default, true)
            vm.Email = 'ada@acme.test'
            await vm.Continue()
            vm.PlatformSignInCommand.Execute()
            await Harness.Flush()
            expect(vm.Step).toBe(AccountDialogStep.SignedIn)
            expect(h.Closed).toBe(1)
        })

        it('a failing platform step shows its sentence on SignedIn and stays signed in', async () =>
        {
            const h = Harness.Offered()
            h.Account.PlatformGate = new Deferred<void>()
            const vm = h.Make(PlatformAddress.Default, true)
            vm.Email = 'ada@acme.test'
            await vm.Continue()
            vm.PlatformSignInCommand.Execute()
            await Harness.Flush()
            h.Account.PlatformGate.Reject(new AccountError(AccountErrorKind.SignInFailed))
            await Harness.Flush()
            expect(vm.Step).toBe(AccountDialogStep.SignedIn)
            expect(vm.Message).toBe(new AccountError(AccountErrorKind.SignInFailed).message)
            expect(vm.HasMessage).toBe(true)
            expect(h.Account.State.SignedIn).toBe(true)
            expect(vm.ShowsPlatformOffer).toBe(true)
            expect(vm.IsBusy).toBe(false)
            expect(h.Closed).toBe(0)
        })

        it('Cancel while waiting on the platform returns to SignedIn and cancels the sign-in', async () =>
        {
            const h = Harness.Offered()
            h.Account.PlatformGate = new Deferred<void>()
            const vm = h.Make()
            vm.Email = 'ada@acme.test'
            await vm.Continue()
            vm.PlatformSignInCommand.Execute()
            await Harness.Flush()
            expect(vm.Step).toBe(AccountDialogStep.Waiting)
            await vm.Cancel()
            expect(h.Account.CallNames()).toContain('CancelSignIn')
            expect(vm.Step).toBe(AccountDialogStep.SignedIn)
            expect(h.Closed).toBe(0)
            // The pending platform sign-in then fails as cancelled; the dialog stays on SignedIn.
            h.Account.PlatformGate.Reject(new AccountError(AccountErrorKind.Cancelled))
            await Harness.Flush()
            expect(vm.Step).toBe(AccountDialogStep.SignedIn)
            expect(vm.Message).toBe('')
            expect(vm.IsBusy).toBe(false)
        })

        it('Skip lands on SignedIn with the offer still shown and the platform still Offered', async () =>
        {
            const h = Harness.Offered()
            const vm = h.Make()
            vm.Email = 'ada@acme.test'
            await vm.Continue()
            vm.SkipPlatformCommand.Execute()
            expect(vm.Step).toBe(AccountDialogStep.SignedIn)
            expect(vm.ShowsPlatformOffer).toBe(true)
            expect(vm.ShowsPlatformSignedIn).toBe(false)
            expect(h.Account.State.Platform).toBe(PlatformAccess.Offered)
            expect(h.Account.CallNames()).not.toContain('SignInAtPlatform')
            expect(h.Closed).toBe(0)
        })

        it('opened for a sign-in request, Skip closes the dialog', async () =>
        {
            const h = Harness.Offered()
            const vm = h.Make(PlatformAddress.Default, true)
            vm.Email = 'ada@acme.test'
            await vm.Continue()
            vm.SkipPlatformCommand.Execute()
            expect(vm.Step).toBe(AccountDialogStep.SignedIn)
            expect(h.Closed).toBe(1)
        })

        it('the offer button on SignedIn signs in at the platform', async () =>
        {
            const h = new Harness()
            h.Account.SetState({ SignedIn: true, Email: 'ada@acme.test', TenantName: 'Acme', Platform: PlatformAccess.Offered })
            const vm = h.Make()
            expect(vm.Step).toBe(AccountDialogStep.SignedIn)
            expect(vm.ShowsPlatformOffer).toBe(true)
            vm.PlatformSignInCommand.Execute()
            await Harness.Flush()
            expect(h.Account.CallNames()).toEqual(['SignInAtPlatform'])
            expect(vm.Step).toBe(AccountDialogStep.SignedIn)
            expect(vm.ShowsPlatformSignedIn).toBe(true)
        })

        it('a non-offered sign-in goes straight to SignedIn with no platform line', async () =>
        {
            const h = new Harness()
            h.Account.Tenants = [{ Id: 't1', DisplayName: 'Acme' }]
            h.Account.SignInGate.Resolve()
            const vm = h.Make(PlatformAddress.Default, true)
            vm.Email = 'ada@acme.test'
            await vm.Continue()
            expect(vm.Step).toBe(AccountDialogStep.SignedIn)
            expect(vm.ShowsPlatformOffer).toBe(false)
            expect(vm.ShowsPlatformSignedIn).toBe(false)
            expect(h.Closed).toBe(1)
        })

        it('on PlatformOffer, a change elsewhere moves only on sign-out or a settled platform', async () =>
        {
            const h = Harness.Offered()
            const vm = h.Make()
            vm.Email = 'ada@acme.test'
            await vm.Continue()
            h.Account.SetState({ ...h.Account.State })
            expect(vm.Step).toBe(AccountDialogStep.PlatformOffer)
            h.Account.SetState({ ...h.Account.State, Platform: PlatformAccess.SignedIn })
            expect(vm.Step).toBe(AccountDialogStep.SignedIn)
            expect(vm.ShowsPlatformSignedIn).toBe(true)

            const h2 = Harness.Offered()
            const vm2 = h2.Make()
            vm2.Email = 'ada@acme.test'
            await vm2.Continue()
            h2.Account.SetState({ SignedIn: false })
            expect(vm2.Step).toBe(AccountDialogStep.Email)
        })

        it('the platform sign-in does nothing on the Email step', async () =>
        {
            const h = new Harness()
            const vm = h.Make()
            expect(vm.Step).toBe(AccountDialogStep.Email)
            expect(vm.PlatformSignInCommand.CanExecute()).toBe(false)
            vm.PlatformSignInCommand.Execute()
            await Harness.Flush()
            expect(h.Account.Calls).toEqual([])
            expect(vm.Step).toBe(AccountDialogStep.Email)
            expect(vm.IsBusy).toBe(false)
        })

        it('the platform command can run on PlatformOffer and on SignedIn only while offered', async () =>
        {
            const h = Harness.Offered()
            const vm = h.Make()
            vm.Email = 'ada@acme.test'
            await vm.Continue()
            expect(vm.PlatformSignInCommand.CanExecute()).toBe(true)
            vm.SkipPlatformCommand.Execute()
            expect(vm.PlatformSignInCommand.CanExecute()).toBe(true)
            h.Account.SetState({ ...h.Account.State, Platform: PlatformAccess.SignedIn })
            expect(vm.PlatformSignInCommand.CanExecute()).toBe(false)
        })

        it('raises PropertyChanged for the platform members', async () =>
        {
            const h = Harness.Offered()
            const vm = h.Make()
            const seen = new Set<string>()
            for (const name of ['IsPlatformOfferStep', 'ShowsPlatformOffer', 'ShowsPlatformSignedIn'])
            {
                vm.PropertyChanged(name).subscribe(() => { seen.add(name) })
            }
            vm.Email = 'ada@acme.test'
            await vm.Continue()
            expect(seen.has('IsPlatformOfferStep')).toBe(true)
            vm.SkipPlatformCommand.Execute()
            expect(seen.has('ShowsPlatformOffer')).toBe(true)
            vm.PlatformSignInCommand.Execute()
            await Harness.Flush()
            expect(seen.has('ShowsPlatformSignedIn')).toBe(true)
        })
    })
})
