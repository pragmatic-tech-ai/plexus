import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { NodeKey, HierarchyActionContext, type HierarchyItem } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { Solution } from '@pragmatic-tech-ai/todl'
import type { IBuildProgress } from '@pragmatic-tech-ai/todl/build-system-core'
import { HtmlAppContributor } from '../html-app-contributor.js'
import type { IBuildClient } from '../../../build/index.js'
import type { BuildRunRequest, BuildRunResult, BuildApplicable } from '../../../../../shared/build-api.js'

// A fake project row carrying its member as ExtObject (what FileTreeContributor.MemberOf matches).
class FakeItem
{
    public Parent: FakeItem | undefined

    constructor(public readonly Key: string, public readonly ExtObject: unknown)
    {
    }
}

class HtmlAppTestHelper
{
    // A real SolutionMember (FileTreeContributor.MemberOf matches by instance) with a fake local storage.
    public static Member(): any
    {
        const m = new Solution('S').AddMember('./p', 'architecture')
        m.Storage = { ResolveOsPath: (r: string) => `/proj/${r}` } as any
        return m
    }

    // A work service whose run() records the task promise so tests can await/inspect it.
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
}

class FakeBuildClient implements IBuildClient
{
    public Requests: BuildRunRequest[] = []
    public Disposed = 0
    public Subscribed: string[] = []

    constructor(private readonly result: BuildRunResult)
    {
    }

    public Build(req: BuildRunRequest): Promise<BuildRunResult>
    {
        this.Requests.push(req)
        return Promise.resolve(this.result)
    }

    public Applicable(_manifestJson: string): Promise<readonly BuildApplicable[]>
    {
        return Promise.resolve([])
    }

    public OnProgress(runId: string, _p: IBuildProgress): { dispose: () => void }
    {
        this.Subscribed.push(runId)
        return { dispose: () => { this.Disposed++ } }
    }
}

class HtmlAppFakes
{
    public static Server(calls: any): any
    {
        return { Start: (root: string) => { calls.served = root; return Promise.resolve({ Url: 'http://127.0.0.1:4599' }) }, Stop: () => Promise.resolve() }
    }

    public static Fs(calls: any): any
    {
        return { OpenExternal: (p: string) => { calls.opened = p; return Promise.resolve() } }
    }
}

describe('HtmlAppContributor', () =>
{
    it('Open HTML app builds html-bundle via the client with the build-root override, then opens index.html', async () =>
    {
        const calls: any = {}
        const client = new FakeBuildClient({ Ok: true, OutputPath: '/out', Diagnostics: [] })
        const work = HtmlAppTestHelper.Work()
        const c = new HtmlAppContributor(client as any, work as any, HtmlAppFakes.Fs(calls))
        c.Resolve('html.open', HtmlAppTestHelper.CtxFor(HtmlAppTestHelper.Member()))!.Execute()
        await work.task
        expect(client.Requests).toHaveLength(1)
        expect(client.Requests[0].systemId).toBe('html-bundle')
        expect(client.Requests[0].flavorId).toBe('html-bundle')
        expect(client.Requests[0].projectRoot).toBe('/proj/')
        expect(client.Requests[0].options.OutputRootOverride).toBe('/proj/build')
        expect(client.Subscribed).toEqual([client.Requests[0].runId])
        expect(client.Disposed).toBe(1)
        expect(calls.opened).toBe(join('/out', 'index.html'))
    })

    it('Open HTML app does not open when the build fails, and still disposes the subscription', async () =>
    {
        const calls: any = {}
        const client = new FakeBuildClient({ Ok: false, OutputPath: '/x', Diagnostics: [{ severity: 'error', message: 'boom' }] })
        const work = HtmlAppTestHelper.Work()
        const c = new HtmlAppContributor(client as any, work as any, HtmlAppFakes.Fs(calls))
        c.Resolve('html.open', HtmlAppTestHelper.CtxFor(HtmlAppTestHelper.Member()))!.Execute()
        await expect(work.task).rejects.toThrow('Build failed: boom')
        expect(calls.opened).toBeUndefined()
        expect(client.Disposed).toBe(1)
    })

    it('Open HTML app throws when the build reports no output path', async () =>
    {
        const calls: any = {}
        const client = new FakeBuildClient({ Ok: true, OutputPath: undefined, Diagnostics: [] } as BuildRunResult)
        const work = HtmlAppTestHelper.Work()
        const c = new HtmlAppContributor(client as any, work as any, HtmlAppFakes.Fs(calls))
        c.Resolve('html.open', HtmlAppTestHelper.CtxFor(HtmlAppTestHelper.Member()))!.Execute()
        await expect(work.task).rejects.toThrow('Build produced no output path to serve')
        expect(calls.opened).toBeUndefined()
        expect(client.Disposed).toBe(1)
    })

    it('Serve HTML app builds, starts the server for the output dir, and opens its URL', async () =>
    {
        const calls: any = {}
        const client = new FakeBuildClient({ Ok: true, OutputPath: '/out', Diagnostics: [] })
        const opened: string[] = []
        const work = HtmlAppTestHelper.Work()
        const c = new HtmlAppContributor(client as any, work as any, HtmlAppFakes.Fs(calls), HtmlAppFakes.Server(calls), (u: string) => opened.push(u))
        c.Resolve('html.serve', HtmlAppTestHelper.CtxFor(HtmlAppTestHelper.Member()))!.Execute()
        await work.task
        expect(client.Requests[0].options).toEqual({ OutputRootOverride: '/proj/build' })
        expect(calls.served).toBe('/out')
        expect(opened).toEqual(['http://127.0.0.1:4599'])
        expect(client.Disposed).toBe(1)
    })

    it('Serve HTML app does not start the server or open when the build fails', async () =>
    {
        const calls: any = {}
        const client = new FakeBuildClient({ Ok: false, OutputPath: '/x', Diagnostics: [{ severity: 'error', message: 'boom' }] })
        const opened: string[] = []
        const work = HtmlAppTestHelper.Work()
        const c = new HtmlAppContributor(client as any, work as any, HtmlAppFakes.Fs(calls), HtmlAppFakes.Server(calls), (u: string) => opened.push(u))
        c.Resolve('html.serve', HtmlAppTestHelper.CtxFor(HtmlAppTestHelper.Member()))!.Execute()
        await expect(work.task).rejects.toThrow('Build failed: boom')
        expect(calls.served).toBeUndefined()
        expect(opened).toEqual([])
        expect(client.Disposed).toBe(1)
    })
})
