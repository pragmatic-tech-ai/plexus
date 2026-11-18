import { describe, it, expect } from 'vitest'
import { NodeKey, HierarchyActionContext, type HierarchyItem } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { Solution } from '@pragmatic-tech-ai/todl'
import { RunTestContributor } from '../run-test-contributor.js'
import type { IEnvironmentRunTester } from '../../../environment-run-test/environment-run-tester.js'
import { EnvironmentPublishStatus } from '../../../../../shared/environment-publish-api.js'
import type { RunTestResult } from '../../../../../shared/run-test-api.js'
import { ScriptedPicker } from './fake-target-sources.js'
import { TargetSource, type TargetRef } from '../../../../../shared/account-api.js'

class FakeItem
{
    public Parent: FakeItem | undefined

    constructor(public readonly Key: string, public readonly ExtObject: unknown)
    {
    }
}

class Helper
{
    public static Member(): any
    {
        const m = new Solution('S').AddMember('./p', 'architecture')
        m.Storage = {
            ResolveOsPath: (r: string) => `/proj/${r}`,
            ReadText: () => Promise.resolve(JSON.stringify({ type: 'architecture', name: 'my-arch', id: 'orders', version: 1 })),
        } as any
        return m
    }

    public static Work(): any
    {
        const w: any = { run: (t: string, fn: any) => { w.Title = t; w.task = fn({}); w.task.catch(() => undefined); return w.task } }
        return w
    }

    public static Ctx(member: unknown): HierarchyActionContext
    {
        const anchor = new FakeItem(NodeKey.Project, member) as unknown as HierarchyItem
        return new HierarchyActionContext(anchor, [anchor])
    }

    public static async Execute(c: RunTestContributor, ctx: HierarchyActionContext): Promise<void>
    {
        c.Resolve(RunTestContributor.RunTestCommandId, ctx)!.Execute()
        await new Promise((res) => setTimeout(res, 0))
    }
}

class FakeBuildService
{
    public Calls: Array<{ systemId: string; flavorId: string | undefined; options: any }> = []

    constructor(private readonly result: unknown)
    {
    }

    public Build(_storage: unknown, systemId: string, flavorId?: string, _progress?: unknown, options?: any): Promise<unknown>
    {
        this.Calls.push({ systemId, flavorId, options })
        return Promise.resolve(this.result)
    }
}

class FakeRunner implements IEnvironmentRunTester
{
    public Runs: Array<[TargetRef, string]> = []

    constructor(private readonly result: RunTestResult)
    {
    }

    public Run(target: TargetRef, outputDir: string): Promise<RunTestResult>
    {
        this.Runs.push([target, outputDir])
        return Promise.resolve(this.result)
    }
}

class Fixture
{
    public static readonly Loaded: RunTestResult = {
        Status: EnvironmentPublishStatus.Applied, AppName: 'orders', AppVersion: '1', AppUrl: 'https://console.test/app/dev/orders/',
    }

    public static Mutations(): any
    {
        return { EnsureMemberGenerated: () => Promise.resolve(), IsVersionedMember: () => false }
    }

    public static Build(): FakeBuildService
    {
        return new FakeBuildService({ Result: { Ok: true, OutputPath: '/out', Diagnostics: [] } })
    }

    public static Picker(): ScriptedPicker
    {
        return new ScriptedPicker([ScriptedPicker.PickOf({ Environment: 'dev' })])
    }
}

describe('RunTestContributor', () =>
{
    it('builds the remote flavor, runs it on the chosen environment and opens the served-app URL', async () =>
    {
        const svc = Fixture.Build()
        const runner = new FakeRunner(Fixture.Loaded)
        const opened: string[] = []
        const work = Helper.Work()
        const c = new RunTestContributor(svc as any, work, Fixture.Mutations(), runner, Fixture.Picker(), (u) => opened.push(u))
        await Helper.Execute(c, Helper.Ctx(Helper.Member()))
        await work.task
        expect(svc.Calls).toHaveLength(1)
        expect(svc.Calls[0].flavorId).toBe('html-bundle-remote')
        expect(svc.Calls[0].options).toEqual({ OutputRootOverride: '/proj/build-remote', Remote: { AppName: 'orders' } })
        expect(runner.Runs).toEqual([[{ Name: 'dev', Source: TargetSource.Console }, '/out']])
        expect(opened).toEqual(['https://console.test/app/dev/orders/'])
        expect(work.Title).toBe('Running ./p on dev')
    })

    it('opens nothing and fails the task when the load is not applied', async () =>
    {
        const runner = new FakeRunner({ ...Fixture.Loaded, Status: EnvironmentPublishStatus.Denied, Reason: 'no role' })
        const opened: string[] = []
        const work = Helper.Work()
        const c = new RunTestContributor(Fixture.Build() as any, work, Fixture.Mutations(), runner, Fixture.Picker(), (u) => opened.push(u))
        await Helper.Execute(c, Helper.Ctx(Helper.Member()))
        await expect(work.task).rejects.toThrow('Run/Test failed (denied): no role')
        expect(opened).toEqual([])
    })

    it('does nothing when the environment pick is cancelled, and is disabled without a runner', async () =>
    {
        const svc = Fixture.Build()
        const work = Helper.Work()
        const c = new RunTestContributor(svc as any, work, Fixture.Mutations(), new FakeRunner(Fixture.Loaded), new ScriptedPicker([ScriptedPicker.PickOf(undefined)]), () => undefined)
        await Helper.Execute(c, Helper.Ctx(Helper.Member()))
        expect(work.task).toBeUndefined()
        expect(svc.Calls).toHaveLength(0)
        const off = new RunTestContributor({} as any, work, Fixture.Mutations(), undefined)
        expect(off.Resolve(RunTestContributor.RunTestCommandId, Helper.Ctx(Helper.Member()))!.CanExecute()).toBe(false)
        expect(off.Resolve('environment.publish', Helper.Ctx(Helper.Member()))).toBeUndefined()
        expect(off.Actions.map((a) => a.Title)).toEqual(['Run/Test in environment'])
    })
})
