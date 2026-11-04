import { describe, it, expect } from 'vitest'
import { ContributeTargetDialog } from '../contribute-target-dialog.js'
import { FakeGraphSource, FakePickerDialogs, FakeTargetAccount } from './fake-target-sources.js'
import { AccountError, AccountErrorKind, RelayError, TargetKind, TargetStatus } from '../../../../../shared/account-api.js'

class ContributeDialogHarness
{
    public readonly Account: FakeTargetAccount
    public readonly Graphs = new FakeGraphSource()
    public readonly Dialogs = new FakePickerDialogs()
    public readonly Dialog: ContributeTargetDialog

    public constructor(signedIn = true)
    {
        this.Account = new FakeTargetAccount(signedIn)
        this.Dialog = new ContributeTargetDialog(this.Account, this.Graphs, this.Dialogs as any)
    }

    // Opens the picker and waits for its targets (and the first environment's graphs) to load.
    public Shown: Promise<unknown> = Promise.resolve(undefined)

    public async Open(): Promise<void>
    {
        this.Shown = this.Dialog.Show()
        await FakePickerDialogs.Flush()
    }
}

describe('ContributeTargetDialog', () =>
{
    it('asks a signed-out user to sign in and the Sign in button requests the account dialog', async () =>
    {
        const h = new ContributeDialogHarness(false)
        await h.Open()
        expect(h.Dialog.Message).toBe('Sign in to contribute to an environment.')
        expect(h.Dialog.NeedsSignIn).toBe(true)
        expect(h.Dialog.CanContribute).toBe(false)
        expect(h.Account.TargetsCalls).toBe(0)
        h.Dialog.SignInCommand.Execute()
        expect(h.Account.SignInRequests).toBe(1)
    })

    it('shows the signed-out sentence when the session ends while loading', async () =>
    {
        const h = new ContributeDialogHarness()
        h.Account.TargetsError = new AccountError(AccountErrorKind.SignedOut)
        await h.Open()
        expect(h.Dialog.Message).toBe('Sign in to contribute to an environment.')
        expect(h.Dialog.NeedsSignIn).toBe(true)
    })

    it('reloads its targets when the account signs in while it is open', async () =>
    {
        const h = new ContributeDialogHarness(false)
        h.Account.TargetList = { Contribute: [{ Name: 'dev', Status: TargetStatus.Running }], Publish: [] }
        h.Graphs.Graphs = { dev: ['main'] }
        await h.Open()
        expect(h.Dialog.NeedsSignIn).toBe(true)
        h.Account.SetState({ SignedIn: true, Email: 'ann@acme.test' })
        await FakePickerDialogs.Flush()
        expect(h.Dialog.NeedsSignIn).toBe(false)
        expect(h.Dialog.Environments.map((e) => e.Name)).toEqual(['dev'])
        expect(h.Dialog.SelectedGraph).toBe('main')
        expect(h.Dialog.CanContribute).toBe(true)
    })

    it('says when the account has no development environments', async () =>
    {
        const h = new ContributeDialogHarness()
        await h.Open()
        expect(h.Dialog.Message).toBe('Your account has no development environments to contribute to.')
        expect(h.Dialog.NeedsSignIn).toBe(false)
        expect(h.Dialog.CanContribute).toBe(false)
    })

    it('says a selected stopped environment cannot take a contribution', async () =>
    {
        const h = new ContributeDialogHarness()
        h.Account.TargetList = { Contribute: [{ Name: 'dev', Status: TargetStatus.Stopped }], Publish: [] }
        h.Graphs.Graphs = { dev: ['main'] }
        await h.Open()
        expect(h.Dialog.Message).toBe('This environment is stopped. Start it from the tenant console.')
        expect(h.Dialog.CanContribute).toBe(false)
        expect(h.Graphs.Listed).toEqual([])
    })

    it('says when the running environment has no graphs yet', async () =>
    {
        const h = new ContributeDialogHarness()
        h.Account.TargetList = { Contribute: [{ Name: 'dev', Status: TargetStatus.Running }], Publish: [] }
        await h.Open()
        expect(h.Dialog.Message).toBe('This environment has no graphs yet. Create one in the tenant console.')
        expect(h.Dialog.CanContribute).toBe(false)
    })

    it('pre-selects the last choice and reloads the graphs when the environment changes', async () =>
    {
        const h = new ContributeDialogHarness()
        h.Account.TargetList = {
            Contribute: [{ Name: 'alpha', Status: TargetStatus.Running }, { Name: 'dev', Status: TargetStatus.Running }],
            Publish: [],
        }
        h.Account.Last = { [TargetKind.Contribute]: { Environment: 'dev', GraphName: 'second' } }
        h.Graphs.Graphs = { alpha: ['a1'], dev: ['main', 'second'] }
        await h.Open()
        expect(h.Dialog.SelectedEnvironment?.Name).toBe('dev')
        expect(h.Dialog.Graphs).toEqual(['main', 'second'])
        expect(h.Dialog.SelectedGraph).toBe('second')
        expect(h.Dialog.CanContribute).toBe(true)
        h.Dialog.SelectedEnvironment = h.Dialog.Environments[0]
        await FakePickerDialogs.Flush()
        expect(h.Graphs.Listed).toEqual(['dev', 'alpha'])
        expect(h.Dialog.Graphs).toEqual(['a1'])
        expect(h.Dialog.SelectedGraph).toBe('a1')
        expect(h.Dialog.Message).toBe('')
    })

    it('shows a relay sentence, and a fixed sentence for anything else', async () =>
    {
        const h = new ContributeDialogHarness()
        h.Account.TargetList = { Contribute: [{ Name: 'dev', Status: TargetStatus.Running }], Publish: [] }
        h.Graphs.ListError = new RelayError('The environment dev could not be reached.')
        await h.Open()
        expect(h.Dialog.Message).toBe('The environment dev could not be reached.')
        const other = new ContributeDialogHarness()
        other.Account.TargetsError = new Error('ECONNREFUSED http://10.0.0.1/secret')
        await other.Open()
        expect(other.Dialog.Message).toBe('Something went wrong. Try again.')
    })

    it('resolves the chosen target on Contribute and remembers it; Cancel resolves nothing', async () =>
    {
        const h = new ContributeDialogHarness()
        h.Account.TargetList = { Contribute: [{ Name: 'dev', Status: TargetStatus.Running }], Publish: [] }
        h.Graphs.Graphs = { dev: ['main'] }
        await h.Open()
        const shown = h.Shown
        expect(h.Dialogs.Shown.map((s) => s.Title)).toEqual(['Contribute to graph'])
        expect(h.Dialogs.Shown[0]!.Content).toBe(h.Dialog)
        h.Dialog.ConfirmCommand.Execute()
        await expect(shown).resolves.toEqual({ Environment: 'dev', GraphName: 'main' })
        expect(h.Account.Remembered).toEqual([[TargetKind.Contribute, { Environment: 'dev', GraphName: 'main' }]])
        await h.Open()
        const again = h.Shown
        h.Dialog.CancelCommand.Execute()
        await expect(again).resolves.toBeUndefined()
        expect(h.Account.Remembered).toHaveLength(1)
    })

    it('stops following the account once closed', async () =>
    {
        const h = new ContributeDialogHarness(false)
        await h.Open()
        const shown = h.Shown
        h.Dialog.CancelCommand.Execute()
        await shown
        h.Account.SetState({ SignedIn: true })
        await FakePickerDialogs.Flush()
        expect(h.Account.TargetsCalls).toBe(0)
    })
})
