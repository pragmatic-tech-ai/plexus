import { describe, it, expect } from 'vitest'
import { NodeKey, HierarchyActionContext, type HierarchyItem } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { Solution, RemoteBindMode } from '@pragmatic-tech-ai/todl'
import { PublishTenantContributor } from '../publish-tenant-contributor.js'
import { BuildProgressReporter } from '../build-progress-reporter.js'
import type { ITenantPublisher } from '../../../tenant-publish/tenant-publisher.js'
import { TenantPublishStatus, type TenantPublishResult } from '../../../../../shared/tenant-publish-api.js'
import type { ITargetPicker } from '../target-dialog.js'
import type { TargetChoice } from '../../../../../shared/account-api.js'

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
        // The task is observed at once (as BackgroundWorkService does), so a rejection awaited after the
        // prompt flush is not reported as unhandled.
        const w: any = { run: (t: string, fn: any) => { w.Title = t; w.task = fn({}); w.task.catch(() => undefined); return w.task } }
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

    // Runs the command and waits past the environment prompt, so work.task is set when publishing.
    public static async Execute(c: PublishTenantContributor, id: string, ctx: HierarchyActionContext): Promise<void>
    {
        c.Resolve(id, ctx)!.Execute()
        await new Promise((res) => setTimeout(res, 0))
    }

    public static ActionById(c: PublishTenantContributor, id: string): any
    {
        return c.Actions.find((a) => a.Id === id)!
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
    public Published: Array<[string, string]> = []

    constructor(private readonly result: TenantPublishResult)
    {
    }

    public Publish(environment: string, outputDir: string): Promise<TenantPublishResult>
    {
        this.Published.push([environment, outputDir])
        return Promise.resolve(this.result)
    }
}

class FakePrompt implements ITargetPicker
{
    constructor(private readonly environment: string | undefined | Error)
    {
    }

    public Show(): Promise<TargetChoice | undefined>
    {
        if (this.environment instanceof Error) return Promise.reject(this.environment)
        return Promise.resolve(this.environment === undefined ? undefined : { Environment: this.environment })
    }
}

describe('PublishTenantContributor', () =>
{
    const Applied: TenantPublishResult = { Status: TenantPublishStatus.Applied, AppName: 'orders', AppVersion: '1' }

    it('builds the html-bundle-remote flavor with the remote target, then publishes the output dir', async () =>
    {
        const svc = new FakeBuildService({ Result: { Ok: true, OutputPath: '/out', Diagnostics: [] } })
        const publisher = new FakePublisher(Applied)
        const work = PublishTestHelper.Work()
        const c = new PublishTenantContributor(svc as any, work, PublishTestHelper.Mutations(), publisher, new FakePrompt('prod'))
        await PublishTestHelper.Execute(c, 'tenant.publish', PublishTestHelper.CtxFor(PublishTestHelper.Member()))
        await expect(work.task).resolves.toEqual(Applied)
        expect(svc.Calls).toHaveLength(1)
        expect(svc.Calls[0].systemId).toBe('html-bundle')
        expect(svc.Calls[0].flavorId).toBe('html-bundle-remote')
        expect(svc.Calls[0].progress).toBeInstanceOf(BuildProgressReporter)
        expect(svc.Calls[0].options).toEqual({ OutputRootOverride: '/proj/build-remote', Remote: { AppName: 'orders', Bind: RemoteBindMode.Application } })
        expect(publisher.Published).toEqual([['prod', '/out']])
        expect(work.Title).toBe('Publishing ./p to prod')
    })

    it('does not publish when the build fails', async () =>
    {
        const svc = new FakeBuildService({ Result: { Ok: false, OutputPath: '/x', Diagnostics: [{ severity: 'error', message: 'boom' }] } })
        const publisher = new FakePublisher(Applied)
        const work = PublishTestHelper.Work()
        const c = new PublishTenantContributor(svc as any, work, PublishTestHelper.Mutations(), publisher, new FakePrompt('prod'))
        await PublishTestHelper.Execute(c, 'tenant.publish', PublishTestHelper.CtxFor(PublishTestHelper.Member()))
        await expect(work.task).rejects.toThrow('Build failed: boom')
        expect(publisher.Published).toEqual([])
    })

    it('fails the task with the server status and reason when the deploy is not applied', async () =>
    {
        const svc = new FakeBuildService({ Result: { Ok: true, OutputPath: '/out', Diagnostics: [] } })
        const publisher = new FakePublisher({ Status: TenantPublishStatus.Denied, Reason: 'not an admin', AppName: 'orders', AppVersion: '1' })
        const work = PublishTestHelper.Work()
        const c = new PublishTenantContributor(svc as any, work, PublishTestHelper.Mutations(), publisher, new FakePrompt('prod'))
        await PublishTestHelper.Execute(c, 'tenant.publish', PublishTestHelper.CtxFor(PublishTestHelper.Member()))
        await expect(work.task).rejects.toThrow('Publish to tenant failed (denied): not an admin')
    })

    it('publishes nothing when the environment prompt is cancelled', async () =>
    {
        const svc = new FakeBuildService({ Result: { Ok: true, OutputPath: '/out', Diagnostics: [] } })
        const publisher = new FakePublisher(Applied)
        const work = PublishTestHelper.Work()
        const c = new PublishTenantContributor(svc as any, work, PublishTestHelper.Mutations(), publisher, new FakePrompt(undefined))
        await PublishTestHelper.Execute(c, 'tenant.publish', PublishTestHelper.CtxFor(PublishTestHelper.Member()))
        expect(work.task).toBeUndefined()
        expect(svc.Calls).toHaveLength(0)
        expect(publisher.Published).toEqual([])
    })

    it('fails a task row, never an unhandled rejection, when the environment prompt fails', async () =>
    {
        const svc = new FakeBuildService({ Result: { Ok: true, OutputPath: '/out', Diagnostics: [] } })
        const publisher = new FakePublisher(Applied)
        const work = PublishTestHelper.Work()
        const c = new PublishTenantContributor(svc as any, work, PublishTestHelper.Mutations(), publisher, new FakePrompt(new Error('prompt broke')))
        await PublishTestHelper.Execute(c, 'tenant.publish', PublishTestHelper.CtxFor(PublishTestHelper.Member()))
        await expect(work.task).rejects.toThrow('prompt broke')
        expect(svc.Calls).toHaveLength(0)
        expect(publisher.Published).toEqual([])
    })

    it('offers no configure command', () =>
    {
        const c = new PublishTenantContributor({} as any, PublishTestHelper.Work(), PublishTestHelper.Mutations(), new FakePublisher(Applied), new FakePrompt('prod'))
        expect(c.Actions.map((a) => a.Id)).toEqual(['tenant.publish', 'tenant.publish-env'])
        expect(c.Resolve('tenant.configure', PublishTestHelper.CtxFor(PublishTestHelper.Member()))).toBeUndefined()
    })

    it('is disabled without a publisher and ignores other command ids', () =>
    {
        const c = new PublishTenantContributor({} as any, PublishTestHelper.Work(), PublishTestHelper.Mutations(), undefined)
        const ctx = PublishTestHelper.CtxFor(PublishTestHelper.Member())
        expect(c.Resolve('tenant.publish', ctx)!.CanExecute()).toBe(false)
        expect(c.Resolve('html.open', ctx)).toBeUndefined()
    })

    it('env_command_builds_environment_bind_and_publishes', async () =>
    {
        const svc = new FakeBuildService({ Result: { Ok: true, OutputPath: '/out', Diagnostics: [] } })
        const publisher = new FakePublisher(Applied)
        const work = PublishTestHelper.Work()
        const c = new PublishTenantContributor(svc as any, work, PublishTestHelper.Mutations(), publisher, new FakePrompt('prod'))
        await PublishTestHelper.Execute(c, PublishTenantContributor.PublishEnvCommandId, PublishTestHelper.CtxFor(PublishTestHelper.Member()))
        await expect(work.task).resolves.toEqual(Applied)
        expect(svc.Calls).toHaveLength(1)
        expect(svc.Calls[0].flavorId).toBe('html-bundle-remote')
        expect(svc.Calls[0].options.Remote.Bind).toBe(RemoteBindMode.Environment)
        expect(publisher.Published).toEqual([['prod', '/out']])
    })

    it('existing_publish_still_application_bind', async () =>
    {
        const svc = new FakeBuildService({ Result: { Ok: true, OutputPath: '/out', Diagnostics: [] } })
        const work = PublishTestHelper.Work()
        const c = new PublishTenantContributor(svc as any, work, PublishTestHelper.Mutations(), new FakePublisher(Applied), new FakePrompt('prod'))
        await PublishTestHelper.Execute(c, 'tenant.publish', PublishTestHelper.CtxFor(PublishTestHelper.Member()))
        await work.task
        expect(svc.Calls[0].options.Remote.Bind).not.toBe(RemoteBindMode.Environment)
        expect(svc.Calls[0].options.Remote.Bind).toBe(RemoteBindMode.Application)
    })

    it('lists both publish commands with ids, labels and orders', () =>
    {
        const c = new PublishTenantContributor({} as any, PublishTestHelper.Work(), PublishTestHelper.Mutations(), undefined)
        const publish = PublishTestHelper.ActionById(c, PublishTenantContributor.PublishCommandId)
        const publishEnv = PublishTestHelper.ActionById(c, PublishTenantContributor.PublishEnvCommandId)
        expect(publish.Order).toBe(54)
        expect(publish.Title).toBe('Publish to tenant')
        expect(publishEnv.Order).toBe(56)
        expect(publishEnv.Title).toBe('Publish to tenant (environment graph)')
        expect(c.Resolve(PublishTenantContributor.PublishEnvCommandId, PublishTestHelper.CtxFor(PublishTestHelper.Member()))!.CanExecute()).toBe(false)
    })
})
