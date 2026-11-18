import { describe, it, expect } from 'vitest'
import { RunTestTargetDialog } from '../run-test-target-dialog.js'
import { FakePickerDialogs, FakeTargetAccount } from './fake-target-sources.js'
import { TargetKind, TargetSource, TargetStatus, type EnvironmentTarget } from '../../../../../shared/account-api.js'

class Harness
{
    public readonly Account = new FakeTargetAccount(true)
    public readonly Dialog = new RunTestTargetDialog(this.Account, new FakePickerDialogs() as any)

    public static Env(name: string): EnvironmentTarget
    {
        return { Id: `console:${name}`, Name: name, Status: TargetStatus.Running, Source: TargetSource.Console }
    }

    public async Open(): Promise<void>
    {
        void this.Dialog.Show()
        await FakePickerDialogs.Flush()
    }
}

describe('RunTestTargetDialog', () =>
{
    it('lists the Develop environments, not the Publish (Runtime) ones', async () =>
    {
        const h = new Harness()
        h.Account.TargetList = { Contribute: [Harness.Env('c')], Publish: [Harness.Env('runtime')], Develop: [Harness.Env('dev')] }
        await h.Open()
        expect(h.Dialog.Environments.map((e) => e.Name)).toEqual(['dev'])
    })

    it('falls back to the contribute (Development) list when no Develop list is supplied', async () =>
    {
        const h = new Harness()
        h.Account.TargetList = { Contribute: [Harness.Env('dev')], Publish: [Harness.Env('runtime')] }
        await h.Open()
        expect(h.Dialog.Environments.map((e) => e.Name)).toEqual(['dev'])
    })

    it('says when there are no development environments and remembers a Develop choice', async () =>
    {
        const h = new Harness()
        h.Account.TargetList = { Contribute: [], Publish: [Harness.Env('runtime')] }
        await h.Open()
        expect(h.Dialog.Message).toBe('Your account has no development environments to run and test in.')
        expect(h.Account.Last[TargetKind.Develop]).toBeUndefined()
    })
})
