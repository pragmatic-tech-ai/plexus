import { describe, it, expect } from 'vitest'
import { OpenFromEnvDialog } from '../open-from-env-dialog.js'
import { TargetPickOutcome } from '../target-dialog.js'
import { FakePickerDialogs, FakeTargetAccount, Gate } from './fake-target-sources.js'
import type { IEnvSolutionLister } from '../../../env-solutions/env-solution-lister.js'
import { RelayError, TargetKind, TargetSource, TargetStatus, type AccountTargets, type TargetRef } from '../../../../../shared/account-api.js'

class FakeSolutionLister implements IEnvSolutionLister
{
    public Solutions: Record<string, string[]> = {}
    public readonly Listed: TargetRef[] = []
    public Failure: unknown = undefined
    // Per-environment gates: a listed environment's answer waits until its gate is released.
    public readonly Gates = new Map<string, Promise<void>>()

    public async ListSolutions(target: TargetRef): Promise<string[]>
    {
        this.Listed.push(target)
        await this.Gates.get(target.Name)
        if (this.Failure !== undefined) throw this.Failure
        return this.Solutions[target.Name] ?? []
    }
}

class OpenDialogHarness
{
    public readonly Account = new FakeTargetAccount(true)
    public readonly Lister = new FakeSolutionLister()
    public readonly Dialogs = new FakePickerDialogs()
    public readonly Dialog = new OpenFromEnvDialog(this.Account, this.Lister, this.Dialogs as any)
    public Shown: Promise<unknown> = Promise.resolve(undefined)

    public static Env(name: string, status = TargetStatus.Running): AccountTargets['Contribute'][number]
    {
        return { Id: `console:${name}`, Name: name, Status: status, Source: TargetSource.Console }
    }

    public async Open(): Promise<void>
    {
        this.Shown = this.Dialog.Show()
        await FakePickerDialogs.Flush()
    }
}

describe('OpenFromEnvDialog', () =>
{
    it('lists the solutions of the selected environment into the second dropdown', async () =>
    {
        const h = new OpenDialogHarness()
        h.Account.TargetList = { Contribute: [OpenDialogHarness.Env('alpha'), OpenDialogHarness.Env('beta')], Publish: [] }
        h.Lister.Solutions = { alpha: ['a1'], beta: ['b1', 'b2'] }
        await h.Open()
        expect(h.Lister.Listed.map((t) => t.Name)).toEqual(['alpha'])
        expect(h.Dialog.Solutions).toEqual(['a1'])
        h.Dialog.SelectedEnvironment = h.Dialog.Environments[1]
        await FakePickerDialogs.Flush()
        expect(h.Lister.Listed.map((t) => t.Name)).toEqual(['alpha', 'beta'])
        expect(h.Dialog.Solutions).toEqual(['b1', 'b2'])
        expect(h.Dialog.SelectedSolution).toBe('b1')
    })

    it('prefers the Develop list over the Contribute list when the console supplies one', async () =>
    {
        const h = new OpenDialogHarness()
        h.Account.TargetList = { Contribute: [OpenDialogHarness.Env('c')], Publish: [], Develop: [OpenDialogHarness.Env('d')] }
        h.Lister.Solutions = { d: ['s'] }
        await h.Open()
        expect(h.Dialog.Environments.map((e) => e.Name)).toEqual(['d'])
    })

    it('resolves the environment and solution name when confirmed, remembering a Develop choice', async () =>
    {
        const h = new OpenDialogHarness()
        h.Account.TargetList = { Contribute: [OpenDialogHarness.Env('dev')], Publish: [] }
        h.Lister.Solutions = { dev: ['one', 'two'] }
        await h.Open()
        h.Dialog.SelectedSolution = 'two'
        expect(h.Dialog.ConfirmCommand.CanExecute(undefined)).toBe(true)
        h.Dialog.ConfirmCommand.Execute()
        const choice = { Environment: 'dev', Source: TargetSource.Console, SolutionName: 'two' }
        await expect(h.Shown).resolves.toEqual({ Outcome: TargetPickOutcome.Chosen, Choice: choice })
        expect(h.Account.Remembered).toEqual([[TargetKind.Develop, choice]])
    })

    it('cannot confirm without a solution, and cancel yields no selection', async () =>
    {
        const h = new OpenDialogHarness()
        h.Account.TargetList = { Contribute: [OpenDialogHarness.Env('dev')], Publish: [] }
        await h.Open()
        expect(h.Dialog.HasSolutions).toBe(false)
        expect(h.Dialog.Message).toBe('This environment has no solutions yet. Upload one first.')
        expect(h.Dialog.ConfirmCommand.CanExecute(undefined)).toBe(false)
        h.Dialog.CancelCommand.Execute()
        await expect(h.Shown).resolves.toEqual({ Outcome: TargetPickOutcome.Cancelled })
        expect(h.Account.Remembered).toEqual([])
    })

    it('shows the failure and stays unconfirmable when listing rejects', async () =>
    {
        const h = new OpenDialogHarness()
        h.Account.TargetList = { Contribute: [OpenDialogHarness.Env('dev')], Publish: [] }
        h.Lister.Failure = new RelayError('The environment refused the connection.')
        await h.Open()
        expect(h.Dialog.Message).toBe('The environment refused the connection.')
        expect(h.Dialog.HasSolutions).toBe(false)
        expect(h.Dialog.SelectedSolution).toBeUndefined()
        expect(h.Dialog.IsBusy).toBe(false)
        expect(h.Dialog.ConfirmCommand.CanExecute(undefined)).toBe(false)
    })

    it('drops a slow listing of a superseded environment selection', async () =>
    {
        const h = new OpenDialogHarness()
        h.Account.TargetList = { Contribute: [OpenDialogHarness.Env('alpha'), OpenDialogHarness.Env('beta')], Publish: [] }
        h.Lister.Solutions = { alpha: ['stale'], beta: ['fresh'] }
        const slow = new Gate<void>()
        h.Lister.Gates.set('alpha', slow.Promise)
        await h.Open()
        expect(h.Dialog.SelectedEnvironment?.Name).toBe('alpha')
        h.Dialog.SelectedEnvironment = h.Dialog.Environments[1]
        await FakePickerDialogs.Flush()
        expect(h.Dialog.Solutions).toEqual(['fresh'])
        slow.Resolve()
        await FakePickerDialogs.Flush()
        expect(h.Dialog.Solutions).toEqual(['fresh'])
        expect(h.Dialog.SelectedSolution).toBe('fresh')
    })

    it('does not list solutions of a stopped environment', async () =>
    {
        const h = new OpenDialogHarness()
        h.Account.TargetList = { Contribute: [OpenDialogHarness.Env('dev', TargetStatus.Stopped)], Publish: [] }
        h.Lister.Solutions = { dev: ['x'] }
        await h.Open()
        expect(h.Lister.Listed).toEqual([])
        expect(h.Dialog.ConfirmCommand.CanExecute(undefined)).toBe(false)
    })

    it('preselects the remembered solution of the remembered environment', async () =>
    {
        const h = new OpenDialogHarness()
        h.Account.TargetList = { Contribute: [OpenDialogHarness.Env('dev')], Publish: [] }
        h.Account.Last[TargetKind.Develop] = { Environment: 'dev', Source: TargetSource.Console, SolutionName: 'two' }
        h.Lister.Solutions = { dev: ['one', 'two'] }
        await h.Open()
        expect(h.Dialog.SelectedSolution).toBe('two')
    })
})
