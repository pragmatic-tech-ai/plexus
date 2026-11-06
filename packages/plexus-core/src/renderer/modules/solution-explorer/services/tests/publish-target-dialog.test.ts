import { describe, it, expect } from 'vitest'
import { PublishTargetDialog } from '../publish-target-dialog.js'
import { TargetPickOutcome } from '../target-dialog.js'
import { FakePickerDialogs, FakeTargetAccount } from './fake-target-sources.js'
import { AccountError, AccountErrorKind, TargetKind, TargetSource, TargetStatus } from '../../../../../shared/account-api.js'

class PublishDialogHarness
{
    public readonly Account: FakeTargetAccount
    public readonly Dialogs = new FakePickerDialogs()
    public readonly Dialog: PublishTargetDialog

    public constructor(signedIn = true)
    {
        this.Account = new FakeTargetAccount(signedIn)
        this.Dialog = new PublishTargetDialog(this.Account, this.Dialogs as any)
    }

    public Shown: Promise<unknown> = Promise.resolve(undefined)

    public async Open(): Promise<void>
    {
        this.Shown = this.Dialog.Show()
        await FakePickerDialogs.Flush()
    }
}

describe('PublishTargetDialog', () =>
{
    it('asks a signed-out user to sign in', async () =>
    {
        const h = new PublishDialogHarness(false)
        await h.Open()
        expect(h.Dialog.Message).toBe('Sign in to publish to an environment.')
        expect(h.Dialog.NeedsSignIn).toBe(true)
        expect(h.Dialog.ConfirmCommand.CanExecute(undefined)).toBe(false)
        h.Dialog.SignInCommand.Execute()
        await expect(h.Shown).resolves.toEqual({ Outcome: TargetPickOutcome.SignIn })
    })

    it('shows the signed-out sentence when the session ends while loading', async () =>
    {
        const h = new PublishDialogHarness()
        h.Account.TargetsError = new AccountError(AccountErrorKind.SignedOut)
        await h.Open()
        expect(h.Dialog.Message).toBe('Sign in to publish to an environment.')
        expect(h.Dialog.NeedsSignIn).toBe(true)
    })

    it('says when the account has no runtime environments', async () =>
    {
        const h = new PublishDialogHarness()
        h.Account.TargetList = { Contribute: [{ Id: 'console:dev', Name: 'dev', Status: TargetStatus.Running, Source: TargetSource.Console }], Publish: [] }
        await h.Open()
        expect(h.Dialog.Message).toBe('Your account has no runtime environments to publish to.')
        expect(h.Dialog.ConfirmCommand.CanExecute(undefined)).toBe(false)
    })

    it('says a selected stopped environment cannot be published to', async () =>
    {
        const h = new PublishDialogHarness()
        h.Account.TargetList = { Contribute: [], Publish: [{ Id: 'console:prod', Name: 'prod', Status: TargetStatus.Stopped, Source: TargetSource.Console }] }
        await h.Open()
        expect(h.Dialog.Message).toBe('This environment is stopped. Start it from the tenant console.')
        expect(h.Dialog.ConfirmCommand.CanExecute(undefined)).toBe(false)
        expect(h.Dialog.Environments.map((e) => e.Label)).toEqual(['prod (stopped)'])
    })

    it('says a failed or unknown environment is not running', async () =>
    {
        for (const status of [TargetStatus.Failed, TargetStatus.Unknown])
        {
            const h = new PublishDialogHarness()
            h.Account.TargetList = { Contribute: [], Publish: [{ Id: 'console:prod', Name: 'prod', Status: status, Source: TargetSource.Console }] }
            await h.Open()
            expect(h.Dialog.Message).toBe('This environment is not running. Check it in the tenant console.')
            expect(h.Dialog.ConfirmCommand.CanExecute(undefined)).toBe(false)
        }
    })

    it('pre-selects the last choice, resolves it on Publish and remembers it', async () =>
    {
        const h = new PublishDialogHarness()
        h.Account.TargetList = {
            Contribute: [],
            Publish: [{ Id: 'console:prod', Name: 'prod', Status: TargetStatus.Running, Source: TargetSource.Console }, { Id: 'console:stage', Name: 'stage', Status: TargetStatus.Running, Source: TargetSource.Console }],
        }
        h.Account.Last = { [TargetKind.Publish]: { Environment: 'stage' } }
        await h.Open()
        const shown = h.Shown
        expect(h.Dialogs.Shown.map((s) => s.Title)).toEqual(['Publish to tenant'])
        expect(h.Dialog.SelectedEnvironment?.Name).toBe('stage')
        expect(h.Dialog.ConfirmCommand.CanExecute(undefined)).toBe(true)
        expect(h.Dialog.Message).toBe('')
        h.Dialog.ConfirmCommand.Execute()
        await expect(shown).resolves.toEqual({ Outcome: TargetPickOutcome.Chosen, Choice: { Environment: 'stage', Source: TargetSource.Console } })
        expect(h.Account.Remembered).toEqual([[TargetKind.Publish, { Environment: 'stage', Source: TargetSource.Console }]])
    })

    it('resolves the platform source for a platform environment', async () =>
    {
        const h = new PublishDialogHarness()
        h.Account.TargetList = { Contribute: [], Publish: [{ Id: 'platform:prod', Name: 'prod', Status: TargetStatus.Running, Source: TargetSource.Platform }] }
        await h.Open()
        expect(h.Dialog.SelectedEnvironment?.Ref).toEqual({ Name: 'prod', Source: TargetSource.Platform })
        h.Dialog.ConfirmCommand.Execute()
        await expect(h.Shown).resolves.toEqual({ Outcome: TargetPickOutcome.Chosen, Choice: { Environment: 'prod', Source: TargetSource.Platform } })
    })

    it('raises ConfirmCommand.CanExecuteChanged on every readiness change, so the Publish button follows it', async () =>
    {
        const h = new PublishDialogHarness(false)
        h.Account.TargetList = { Contribute: [], Publish: [{ Id: 'console:prod', Name: 'prod', Status: TargetStatus.Running, Source: TargetSource.Console }] }
        const seen: boolean[] = []
        h.Dialog.ConfirmCommand.AddCanExecuteChangedListener(() => seen.push(h.Dialog.ConfirmCommand.CanExecute(undefined)))
        await h.Open()
        expect(h.Dialog.ConfirmCommand.CanExecute(undefined)).toBe(false)
        h.Account.SetState({ SignedIn: true, Email: 'ann@acme.test' })
        await FakePickerDialogs.Flush()
        expect(seen.at(-1)).toBe(true)
        h.Dialog.SelectedEnvironment = undefined
        expect(seen.at(-1)).toBe(false)
    })
})
