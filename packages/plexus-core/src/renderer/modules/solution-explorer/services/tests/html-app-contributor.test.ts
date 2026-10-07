import { describe, it, expect } from 'vitest'
import { NodeKey, HierarchyActionContext, type HierarchyItem } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { Solution } from '@pragmatic-tech-ai/todl'
import { HtmlAppContributor } from '../html-app-contributor.js'

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

describe('HtmlAppContributor', () =>
{
    it('Open HTML app builds html-bundle with the project build-root override, then opens index.html', async () =>
    {
        const calls: any = {}
        const build = { Build: (_storage: any, system: string, flavor: string, _p: any, options: any) =>
        {
            calls.build = { system, flavor, options }
            return Promise.resolve({ Result: { Ok: true, OutputPath: '/proj/build/html-bundle', Diagnostics: [] }, Artifacts: {} })
        } }
        const fs = { OpenExternal: (p: string) => { calls.opened = p; return Promise.resolve() } }
        const work = HtmlAppTestHelper.Work()
        const member = HtmlAppTestHelper.Member()
        const c = new HtmlAppContributor(build as any, work as any, fs as any)
        c.Resolve('html.open', HtmlAppTestHelper.CtxFor(member))!.Execute()
        await work.task
        expect(calls.build.system).toBe('html-bundle')
        expect(calls.build.flavor).toBe('html-bundle')
        expect(calls.build.options.OutputRootOverride).toBe('/proj/build')
        expect(calls.opened).toBe('/proj/build/html-bundle/index.html')
    })

    it('Open HTML app does not open when the build fails', async () =>
    {
        const calls: any = {}
        const build = { Build: () => Promise.resolve({ Result: { Ok: false, OutputPath: '/x', Diagnostics: [{ severity: 0, message: 'boom' }] }, Artifacts: {} }) }
        const fs = { OpenExternal: (p: string) => { calls.opened = p; return Promise.resolve() } }
        const work = HtmlAppTestHelper.Work()
        const member = HtmlAppTestHelper.Member()
        const c = new HtmlAppContributor(build as any, work as any, fs as any)
        c.Resolve('html.open', HtmlAppTestHelper.CtxFor(member))!.Execute()
        await expect(work.task).rejects.toThrow()
        expect(calls.opened).toBeUndefined()
    })
})
