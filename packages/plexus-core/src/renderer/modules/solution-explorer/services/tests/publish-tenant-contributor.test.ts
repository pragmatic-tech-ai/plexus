import { describe, it, expect } from 'vitest'
import { NodeKey, HierarchyActionContext, type HierarchyItem } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { Solution, RemoteBindMode } from '@pragmatic-tech-ai/todl'
import { PublishTenantContributor } from '../publish-tenant-contributor.js'
import { BuildProgressReporter } from '../build-progress-reporter.js'
import type { ITenantPublisher } from '../../../tenant-publish/tenant-publisher.js'
import { TenantPublishStatus, type TenantPublishResult } from '../../../../../shared/tenant-publish-api.js'
import type { ITenantProfilePrompt } from '../tenant-profile-dialog.js'

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
    public Published: string[] = []
    public Profiles: Array<[string, string]> = []

    constructor(private readonly result: TenantPublishResult)
    {
    }

    public Publish(outputDir: string): Promise<TenantPublishResult>
    {
        this.Published.push(outputDir)
        return Promise.resolve(this.result)
    }

    public SetProfile(serverUrl: string, token: string): Promise<void>
    {
        this.Profiles.push([serverUrl, token])
        return Promise.resolve()
    }
}

class FakePrompt implements ITenantProfilePrompt
{
    constructor(private readonly input: { ServerUrl: string; Token: string } | undefined)
    {
    }

    public Prompt(): Promise<{ ServerUrl: string; Token: string } | undefined>
    {
        return Promise.resolve(this.input)
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
        const c = new PublishTenantContributor(svc as any, work, PublishTestHelper.Mutations(), publisher)
        c.Resolve('tenant.publish', PublishTestHelper.CtxFor(PublishTestHelper.Member()))!.Execute()
        await expect(work.task).resolves.toEqual(Applied)
        expect(svc.Calls).toHaveLength(1)
        expect(svc.Calls[0].systemId).toBe('html-bundle')
        expect(svc.Calls[0].flavorId).toBe('html-bundle-remote')
        expect(svc.Calls[0].progress).toBeInstanceOf(BuildProgressReporter)
        expect(svc.Calls[0].options).toEqual({ OutputRootOverride: '/proj/build-remote', Remote: { AppName: 'orders' } })
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
        const publisher = new FakePublisher({ Status: TenantPublishStatus.Denied, Reason: 'not an admin', AppName: 'orders', AppVersion: '1' })
        const work = PublishTestHelper.Work()
        const c = new PublishTenantContributor(svc as any, work, PublishTestHelper.Mutations(), publisher)
        c.Resolve('tenant.publish', PublishTestHelper.CtxFor(PublishTestHelper.Member()))!.Execute()
        await expect(work.task).rejects.toThrow('Publish to tenant failed (denied): not an admin')
    })

    it('Configure tenant prompts and stores the profile; cancel stores nothing', async () =>
    {
        const publisher = new FakePublisher(Applied)
        const ctx = PublishTestHelper.CtxFor(PublishTestHelper.Member())
        const ok = new PublishTenantContributor({} as any, PublishTestHelper.Work(), PublishTestHelper.Mutations(), publisher, new FakePrompt({ ServerUrl: 'wss://srv', Token: 't0k' }))
        ok.Resolve('tenant.configure', ctx)!.Execute()
        await new Promise((res) => setTimeout(res, 0))
        expect(publisher.Profiles).toEqual([['wss://srv', 't0k']])
        const cancelled = new FakePublisher(Applied)
        new PublishTenantContributor({} as any, PublishTestHelper.Work(), PublishTestHelper.Mutations(), cancelled, new FakePrompt(undefined)).Resolve('tenant.configure', ctx)!.Execute()
        await new Promise((res) => setTimeout(res, 0))
        expect(cancelled.Profiles).toEqual([])
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
        const c = new PublishTenantContributor(svc as any, work, PublishTestHelper.Mutations(), publisher)
        c.Resolve(PublishTenantContributor.PublishEnvCommandId, PublishTestHelper.CtxFor(PublishTestHelper.Member()))!.Execute()
        await expect(work.task).resolves.toEqual(Applied)
        expect(svc.Calls).toHaveLength(1)
        expect(svc.Calls[0].flavorId).toBe('html-bundle-remote')
        expect(svc.Calls[0].options.Remote.Bind).toBe(RemoteBindMode.Environment)
        expect(publisher.Published).toEqual(['/out'])
    })

    it('existing_publish_still_application_bind', async () =>
    {
        const svc = new FakeBuildService({ Result: { Ok: true, OutputPath: '/out', Diagnostics: [] } })
        const work = PublishTestHelper.Work()
        const c = new PublishTenantContributor(svc as any, work, PublishTestHelper.Mutations(), new FakePublisher(Applied))
        c.Resolve('tenant.publish', PublishTestHelper.CtxFor(PublishTestHelper.Member()))!.Execute()
        await work.task
        expect(svc.Calls[0].options.Remote.Bind).not.toBe(RemoteBindMode.Environment)
        expect(svc.Calls[0].options.Remote.Bind).toBe(RemoteBindMode.Application)
    })

    it('never hands a token to the publisher on publish (token stays main-side)', async () =>
    {
        const svc = new FakeBuildService({ Result: { Ok: true, OutputPath: '/out', Diagnostics: [] } })
        const publisher = new FakePublisher(Applied)
        const work = PublishTestHelper.Work()
        const c = new PublishTenantContributor(svc as any, work, PublishTestHelper.Mutations(), publisher)
        c.Resolve(PublishTenantContributor.PublishEnvCommandId, PublishTestHelper.CtxFor(PublishTestHelper.Member()))!.Execute()
        await work.task
        expect(publisher.Published).toEqual(['/out'])
        expect(publisher.Profiles).toEqual([])
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
