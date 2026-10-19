import { describe, it, expect } from 'vitest'
import { NodeKey, HierarchyActionContext, type HierarchyItem } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { Solution } from '@pragmatic-tech-ai/todl'
import { PublishTenantContributor } from '../publish-tenant-contributor.js'
import { BuildProgressReporter } from '../build-progress-reporter.js'
import type { ITenantPublisher, TenantPublishResult } from '../../../tenant-publish/tenant-publisher.js'

class FakeItem
{
    public Parent: FakeItem | undefined

    constructor(public readonly Key: string, public readonly ExtObject: unknown)
    {
    }
}

class PublishTestHelper
{
    // A real SolutionMember with fake local storage whose manifest names the project.
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
        const w: any = { run: (_t: string, fn: any) => { w.task = fn({}); return w.task } }
        return w
    }

    public static CtxFor(member: unknown): HierarchyActionContext
    {
        const anchor = new FakeItem(NodeKey.Project, member) as unknown as HierarchyItem
        return new HierarchyActionContext(anchor, [anchor])
    }

    public static Mutations(): any
    {
        return { EnsureMemberGenerated: () => Promise.resolve() }
    }
}

class FakeBuildService
{
    public Calls: Array<{ systemId: string; flavorId: string | undefined; progress: unknown; options: any }> = []

    constructor(private readonly result: unknown)
    {
    }

    public Build(_storage: unknown, systemId: string, flavorId?: string, progress?: unknown, options?: any): Promise<unknown>
    {
        this.Calls.push({ systemId, flavorId, progress, options })
        return Promise.resolve(this.result)
    }
}

class FakePublisher implements ITenantPublisher
{
    public Published: string[] = []

    constructor(private readonly result: TenantPublishResult)
    {
    }

    public Publish(outputDir: string): Promise<TenantPublishResult>
    {
        this.Published.push(outputDir)
        return Promise.resolve(this.result)
    }
}

describe('PublishTenantContributor', () =>
{
    const Applied: TenantPublishResult = { Status: 'applied', AppName: 'orders', AppVersion: '1' }

    it('builds the html-bundle-remote flavor with the remote target, then publishes the output dir', async () =>
    {
        const svc = new FakeBuildService({ Result: { Ok: true, OutputPath: '/out', Diagnostics: [] } })
        const publisher = new FakePublisher(Applied)
        const work = PublishTestHelper.Work()
        const c = new PublishTenantContributor(svc as any, work, PublishTestHelper.Mutations(), publisher)
        c.Resolve('tenant.publish', PublishTestHelper.CtxFor(PublishTestHelper.Member()))!.Execute()
        await expect(work.task).resolves.toEqual(Applied)
        expect(svc.Calls).toHaveLength(1)
        expect(svc.Calls[0].systemId).toBe('html-bundle')
        expect(svc.Calls[0].flavorId).toBe('html-bundle-remote')
        expect(svc.Calls[0].progress).toBeInstanceOf(BuildProgressReporter)
        expect(svc.Calls[0].options).toEqual({ OutputRootOverride: '/proj/build', Remote: { AppName: 'orders' } })
        expect(publisher.Published).toEqual(['/out'])
    })

    it('does not publish when the build fails', async () =>
    {
        const svc = new FakeBuildService({ Result: { Ok: false, OutputPath: '/x', Diagnostics: [{ severity: 'error', message: 'boom' }] } })
        const publisher = new FakePublisher(Applied)
        const work = PublishTestHelper.Work()
        const c = new PublishTenantContributor(svc as any, work, PublishTestHelper.Mutations(), publisher)
        c.Resolve('tenant.publish', PublishTestHelper.CtxFor(PublishTestHelper.Member()))!.Execute()
        await expect(work.task).rejects.toThrow('Build failed: boom')
        expect(publisher.Published).toEqual([])
    })

    it('fails the task with the server status and reason when the deploy is not applied', async () =>
    {
        const svc = new FakeBuildService({ Result: { Ok: true, OutputPath: '/out', Diagnostics: [] } })
        const publisher = new FakePublisher({ Status: 'denied', Reason: 'not an admin', AppName: 'orders', AppVersion: '1' })
        const work = PublishTestHelper.Work()
        const c = new PublishTenantContributor(svc as any, work, PublishTestHelper.Mutations(), publisher)
        c.Resolve('tenant.publish', PublishTestHelper.CtxFor(PublishTestHelper.Member()))!.Execute()
        await expect(work.task).rejects.toThrow('Publish to tenant failed (denied): not an admin')
    })

    it('is disabled without a publisher and ignores other command ids', () =>
    {
        const c = new PublishTenantContributor({} as any, PublishTestHelper.Work(), PublishTestHelper.Mutations(), undefined)
        const ctx = PublishTestHelper.CtxFor(PublishTestHelper.Member())
        expect(c.Resolve('tenant.publish', ctx)!.CanExecute()).toBe(false)
        expect(c.Resolve('html.open', ctx)).toBeUndefined()
    })
})
