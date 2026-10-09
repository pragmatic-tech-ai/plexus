import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { NodeKey, HierarchyActionContext, type HierarchyItem } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { Solution } from '@pragmatic-tech-ai/todl'
import { HtmlAppContributor } from '../html-app-contributor.js'
import { BuildProgressReporter } from '../build-progress-reporter.js'

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

// A fake BuildService: records Build calls and returns a canned ProjectBuildOutput.
class FakeBuildService
{
    public Calls: Array<{ storage: unknown; systemId: string; flavorId: string | undefined; progress: unknown; options: any }> = []

    constructor(private readonly result: unknown)
    {
    }

    public Build(storage: unknown, systemId: string, flavorId?: string, progress?: unknown, options?: any): Promise<unknown>
    {
        this.Calls.push({ storage, systemId, flavorId, progress, options })
        return Promise.resolve(this.result)
    }
}

class HtmlAppFakes
{
    public static Server(calls: any): any
    {
        return { Start: (root: string) => { calls.served = root; return Promise.resolve({ Url: 'http://127.0.0.1:4599' }) }, Stop: () => Promise.resolve() }
    }

    // A fake IContentMutations: records the member EnsureMemberGenerated saw and how many builds had run by then.
    public static Mutations(calls: any, svc: FakeBuildService): any
    {
        return { EnsureMemberGenerated: (m: unknown) => { calls.ensured = m; calls.buildsAtEnsure = svc.Calls.length; return Promise.resolve() } }
    }

    public static Fs(calls: any): any
    {
        return { OpenExternal: (p: string) => { calls.opened = p; return Promise.resolve() } }
    }
}

describe('HtmlAppContributor', () =>
{
    it('Open HTML app builds html-bundle via BuildService with the build-root override, then opens index.html', async () =>
    {
        const calls: any = {}
        const svc = new FakeBuildService({ Result: { Ok: true, OutputPath: '/out', Diagnostics: [] } })
        const work = HtmlAppTestHelper.Work()
        const member = HtmlAppTestHelper.Member()
        const c = new HtmlAppContributor(svc as any, work as any, HtmlAppFakes.Fs(calls), HtmlAppFakes.Mutations(calls, svc))
        c.Resolve('html.open', HtmlAppTestHelper.CtxFor(member))!.Execute()
        await work.task
        expect(svc.Calls).toHaveLength(1)
        expect(svc.Calls[0].storage).toBe(member.Storage)
        expect(svc.Calls[0].systemId).toBe('html-bundle')
        expect(svc.Calls[0].flavorId).toBe('html-bundle')
        expect(svc.Calls[0].progress).toBeInstanceOf(BuildProgressReporter)
        expect(svc.Calls[0].options).toEqual({ OutputRootOverride: '/proj/build' })
        expect(calls.opened).toBe(join('/out', 'index.html'))
        expect(calls.ensured).toBe(member)
        expect(calls.buildsAtEnsure).toBe(0)
    })

    it('Open HTML app does not open when the build fails', async () =>
    {
        const calls: any = {}
        const svc = new FakeBuildService({ Result: { Ok: false, OutputPath: '/x', Diagnostics: [{ severity: 'error', message: 'boom' }] } })
        const work = HtmlAppTestHelper.Work()
        const c = new HtmlAppContributor(svc as any, work as any, HtmlAppFakes.Fs(calls), HtmlAppFakes.Mutations(calls, svc))
        c.Resolve('html.open', HtmlAppTestHelper.CtxFor(HtmlAppTestHelper.Member()))!.Execute()
        await expect(work.task).rejects.toThrow('Build failed: boom')
        expect(calls.opened).toBeUndefined()
    })

    it('Open HTML app throws when the build reports no output path', async () =>
    {
        const calls: any = {}
        const svc = new FakeBuildService({ Result: { Ok: true, OutputPath: undefined, Diagnostics: [] } })
        const work = HtmlAppTestHelper.Work()
        const c = new HtmlAppContributor(svc as any, work as any, HtmlAppFakes.Fs(calls), HtmlAppFakes.Mutations(calls, svc))
        c.Resolve('html.open', HtmlAppTestHelper.CtxFor(HtmlAppTestHelper.Member()))!.Execute()
        await expect(work.task).rejects.toThrow('Build produced no output path to serve')
        expect(calls.opened).toBeUndefined()
    })

    it('Serve HTML app builds, starts the server for the output dir, and opens its URL', async () =>
    {
        const calls: any = {}
        const svc = new FakeBuildService({ Result: { Ok: true, OutputPath: '/out', Diagnostics: [] } })
        const opened: string[] = []
        const work = HtmlAppTestHelper.Work()
        const c = new HtmlAppContributor(svc as any, work as any, HtmlAppFakes.Fs(calls), HtmlAppFakes.Mutations(calls, svc), HtmlAppFakes.Server(calls), (u: string) => opened.push(u))
        const member = HtmlAppTestHelper.Member()
        c.Resolve('html.serve', HtmlAppTestHelper.CtxFor(member))!.Execute()
        await work.task
        expect(calls.ensured).toBe(member)
        expect(calls.buildsAtEnsure).toBe(0)
        expect(svc.Calls[0].options).toEqual({ OutputRootOverride: '/proj/build' })
        expect(calls.served).toBe('/out')
        expect(opened).toEqual(['http://127.0.0.1:4599'])
    })

    it('Serve HTML app does not start the server or open when the build fails', async () =>
    {
        const calls: any = {}
        const svc = new FakeBuildService({ Result: { Ok: false, OutputPath: '/x', Diagnostics: [{ severity: 'error', message: 'boom' }] } })
        const opened: string[] = []
        const work = HtmlAppTestHelper.Work()
        const c = new HtmlAppContributor(svc as any, work as any, HtmlAppFakes.Fs(calls), HtmlAppFakes.Mutations(calls, svc), HtmlAppFakes.Server(calls), (u: string) => opened.push(u))
        c.Resolve('html.serve', HtmlAppTestHelper.CtxFor(HtmlAppTestHelper.Member()))!.Execute()
        await expect(work.task).rejects.toThrow('Build failed: boom')
        expect(calls.served).toBeUndefined()
        expect(opened).toEqual([])
    })
})
