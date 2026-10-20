import { describe, it, expect } from 'vitest'
import { Solution } from '@pragmatic-tech-ai/todl'
import { ContributeToGraphContributor } from '../contribute-to-graph-contributor.js'
import type { IGraphProfilePrompt, GraphProfileInput } from '../graph-profile-dialog.js'
import type { IGraphContributor } from '../../../graph-contribute/graph-contributor.js'
import type { ContributedPackage, GraphContributeResult } from '../../../../../shared/graph-contribute-api.js'

// The maker token used across these tests. It must NEVER appear in a surfaced error message
// or a failed task reason — every error assertion checks it stays out.
const Token = 'SECRET-TOKEN-xyz'

class FakeContributor implements IGraphContributor
{
    public Contributions: Array<{ graphName: string; solutionId: string; packages: ContributedPackage[] }> = []
    public Profiles: Array<[string, string]> = []
    public HasProfileCalls = 0
    private contributeError: Error | undefined
    private setProfileError: Error | undefined

    constructor(private readonly result: GraphContributeResult, private readonly hasProfile: boolean)
    {
    }

    public FailContribute(e: Error): this { this.contributeError = e; return this }
    public FailSetProfile(e: Error): this { this.setProfileError = e; return this }

    public Contribute(graphName: string, solutionId: string, packages: ContributedPackage[]): Promise<GraphContributeResult>
    {
        if (this.contributeError !== undefined) return Promise.reject(this.contributeError)
        this.Contributions.push({ graphName, solutionId, packages })
        return Promise.resolve(this.result)
    }

    public SetProfile(serverUrl: string, token: string): Promise<void>
    {
        if (this.setProfileError !== undefined) return Promise.reject(this.setProfileError)
        this.Profiles.push([serverUrl, token])
        return Promise.resolve()
    }

    public HasProfile(): Promise<boolean>
    {
        this.HasProfileCalls++
        return Promise.resolve(this.hasProfile)
    }
}

class FakeBuilder
{
    public Built = 0

    constructor(private readonly packages: ContributedPackage[], private readonly error: Error | undefined = undefined)
    {
    }

    public Build(): Promise<readonly ContributedPackage[]>
    {
        this.Built++
        if (this.error !== undefined) return Promise.reject(this.error)
        return Promise.resolve(this.packages)
    }
}

class FakePrompt implements IGraphProfilePrompt
{
    public Calls = 0

    constructor(private readonly input: GraphProfileInput | undefined)
    {
    }

    public Prompt(): Promise<GraphProfileInput | undefined>
    {
        this.Calls++
        return Promise.resolve(this.input)
    }
}

class FakeDialogs
{
    public Shown: Array<{ Title: string; Content: any }> = []

    public Show(options: any): Promise<unknown>
    {
        this.Shown.push({ Title: options.Title, Content: options.Content })
        return Promise.resolve(undefined)
    }

    public Close(_r: unknown): void
    {
    }
}

class GraphTestHelper
{
    // A fake BackgroundWorkService.run that captures the task promise so a test can await it.
    public static Work(): any
    {
        const w: any = { run: (_t: string, fn: any) => { w.task = fn({}); return { handle: {}, done: w.task } } }
        return w
    }

    // Drains the microtask chain (prompt → HasProfile → SetProfile) so contribute() reaches work.run.
    public static Flush(): Promise<void>
    {
        return new Promise((res) => setTimeout(res, 0))
    }
}

describe('ContributeToGraphContributor', () =>
{
    const Result: GraphContributeResult = { GraphName: 'g1', PackageCount: 1 }
    const Packages: ContributedPackage[] = [{ id: 'orders', version: '1.0.0', modelJson: '{}' }]
    const Input: GraphProfileInput = { ServerUrl: 'wss://srv', GraphName: 'g1', Token }

    it('builds the solution packages, then contributes them to the named graph and resolves with the result', async () =>
    {
        const solution = new Solution('S')
        const builder = new FakeBuilder(Packages)
        const contributor = new FakeContributor(Result, true)
        const work = GraphTestHelper.Work()
        const c = new ContributeToGraphContributor(solution, builder as any, work, contributor, {} as any, new FakePrompt(Input))
        c.Resolve('graph.contribute', {} as any)!.Execute()
        await GraphTestHelper.Flush()
        await expect(work.task).resolves.toEqual(Result)
        expect(builder.Built).toBe(1)
        expect(contributor.Contributions).toEqual([{ graphName: 'g1', solutionId: 'S', packages: Packages }])
    })

    it('prompts and stores the profile before contributing when no profile exists; skips SetProfile when one does', async () =>
    {
        const noProfile = new FakeContributor(Result, false)
        const c1 = new ContributeToGraphContributor(new Solution('S'), new FakeBuilder(Packages) as any, GraphTestHelper.Work(), noProfile, {} as any, new FakePrompt(Input))
        c1.Resolve('graph.contribute', {} as any)!.Execute()
        await GraphTestHelper.Flush()
        expect(noProfile.Profiles).toEqual([['wss://srv', Token]])
        expect(noProfile.Contributions).toHaveLength(1)

        const hasProfile = new FakeContributor(Result, true)
        const c2 = new ContributeToGraphContributor(new Solution('S'), new FakeBuilder(Packages) as any, GraphTestHelper.Work(), hasProfile, {} as any, new FakePrompt(Input))
        c2.Resolve('graph.contribute', {} as any)!.Execute()
        await GraphTestHelper.Flush()
        expect(hasProfile.Profiles).toEqual([])
        expect(hasProfile.Contributions).toHaveLength(1)
    })

    it('fails the task with the build error reason, and the token never appears in it', async () =>
    {
        const builder = new FakeBuilder(Packages, new Error('build boom'))
        const contributor = new FakeContributor(Result, true)
        const work = GraphTestHelper.Work()
        const c = new ContributeToGraphContributor(new Solution('S'), builder as any, work, contributor, {} as any, new FakePrompt(Input))
        c.Resolve('graph.contribute', {} as any)!.Execute()
        await GraphTestHelper.Flush()
        await expect(work.task).rejects.toThrow('build boom')
        const err = await work.task.then(() => undefined, (e: unknown) => e)
        expect(String(err)).not.toContain(Token)
        expect(contributor.Contributions).toEqual([])
    })

    it('propagates a contributor conflict as the task reason, distinguishable and token-free', async () =>
    {
        const builder = new FakeBuilder(Packages)
        const contributor = new FakeContributor(Result, true).FailContribute(new Error('graph conflict: version already contributed'))
        const work = GraphTestHelper.Work()
        const c = new ContributeToGraphContributor(new Solution('S'), builder as any, work, contributor, {} as any, new FakePrompt(Input))
        c.Resolve('graph.contribute', {} as any)!.Execute()
        await GraphTestHelper.Flush()
        await expect(work.task).rejects.toThrow('graph conflict')
        const err = await work.task.then(() => undefined, (e: unknown) => e)
        expect(String(err)).not.toContain(Token)
    })

    it('surfaces a pre-task SetProfile failure via InfoDialog without running the task or leaking the token', async () =>
    {
        const contributor = new FakeContributor(Result, false).FailSetProfile(new Error('bad profile'))
        const dialogs = new FakeDialogs()
        const work = GraphTestHelper.Work()
        const c = new ContributeToGraphContributor(new Solution('S'), new FakeBuilder(Packages) as any, work, contributor, dialogs as any, new FakePrompt(Input))
        c.Resolve('graph.contribute', {} as any)!.Execute()
        await GraphTestHelper.Flush()
        expect(work.task).toBeUndefined()
        expect(contributor.Contributions).toEqual([])
        expect(dialogs.Shown).toHaveLength(1)
        expect(dialogs.Shown[0]!.Content.Message).toBe('bad profile')
        expect(dialogs.Shown[0]!.Content.Message).not.toContain(Token)
    })

    it('is disabled without active deps and ignores unknown command ids', () =>
    {
        const contributor = new FakeContributor(Result, true)
        const prompt = new FakePrompt(Input)
        const noBuilder = new ContributeToGraphContributor(new Solution('S'), undefined, GraphTestHelper.Work(), contributor, {} as any, prompt)
        expect(noBuilder.Resolve('graph.contribute', {} as any)!.CanExecute()).toBe(false)
        const noContributor = new ContributeToGraphContributor(new Solution('S'), new FakeBuilder(Packages) as any, GraphTestHelper.Work(), undefined, {} as any, prompt)
        expect(noContributor.Resolve('graph.contribute', {} as any)!.CanExecute()).toBe(false)
        const noWork = new ContributeToGraphContributor(new Solution('S'), new FakeBuilder(Packages) as any, undefined, contributor, {} as any, prompt)
        expect(noWork.Resolve('graph.contribute', {} as any)!.CanExecute()).toBe(false)
        expect(noBuilder.Resolve('graph.configure', {} as any)!.CanExecute()).toBe(true)
        expect(noBuilder.Resolve('nope', {} as any)).toBeUndefined()
    })
})
