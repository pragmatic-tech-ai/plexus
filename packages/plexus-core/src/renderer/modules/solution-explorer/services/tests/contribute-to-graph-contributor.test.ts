import { describe, it, expect } from 'vitest'
import { Solution } from '@pragmatic-tech-ai/todl'
import { ContributeToGraphContributor } from '../contribute-to-graph-contributor.js'
import type { IGraphTargetPrompt, GraphTargetInput } from '../graph-profile-dialog.js'
import type { IGraphContributor } from '../../../graph-contribute/graph-contributor.js'
import type { ContributedPackage, GraphContributeResult } from '../../../../../shared/graph-contribute-api.js'

class FakeContributor implements IGraphContributor
{
    public Contributions: Array<{ environment: string; graphName: string; solutionId: string; packages: ContributedPackage[] }> = []
    private contributeError: Error | undefined

    constructor(private readonly result: GraphContributeResult)
    {
    }

    public FailContribute(e: Error): this { this.contributeError = e; return this }

    public Contribute(environment: string, graphName: string, solutionId: string, packages: ContributedPackage[]): Promise<GraphContributeResult>
    {
        if (this.contributeError !== undefined) return Promise.reject(this.contributeError)
        this.Contributions.push({ environment, graphName, solutionId, packages })
        return Promise.resolve(this.result)
    }

    public ListGraphs(_environment: string): Promise<string[]>
    {
        return Promise.resolve([])
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

class FakePrompt implements IGraphTargetPrompt
{
    public Calls = 0

    constructor(private readonly input: GraphTargetInput | undefined | Error)
    {
    }

    public Prompt(): Promise<GraphTargetInput | undefined>
    {
        this.Calls++
        if (this.input instanceof Error) return Promise.reject(this.input)
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

    // Drains the microtask chain (the target prompt) so contribute() reaches work.run.
    public static Flush(): Promise<void>
    {
        return new Promise((res) => setTimeout(res, 0))
    }
}

describe('ContributeToGraphContributor', () =>
{
    const Result: GraphContributeResult = { GraphName: 'g1', PackageCount: 1 }
    const Packages: ContributedPackage[] = [{ id: 'orders', version: '1.0.0', modelJson: '{}' }]
    const Input: GraphTargetInput = { Environment: 'dev', GraphName: 'g1' }

    it('asks for the target, builds the solution packages, then contributes them to the environment graph', async () =>
    {
        const builder = new FakeBuilder(Packages)
        const contributor = new FakeContributor(Result)
        const work = GraphTestHelper.Work()
        const dialogs = new FakeDialogs()
        const c = new ContributeToGraphContributor(new Solution('S'), builder as any, work, contributor, dialogs as any, new FakePrompt(Input))
        c.Resolve('graph.contribute', {} as any)!.Execute()
        await GraphTestHelper.Flush()
        await expect(work.task).resolves.toEqual(Result)
        expect(builder.Built).toBe(1)
        expect(contributor.Contributions).toEqual([{ environment: 'dev', graphName: 'g1', solutionId: 'S', packages: Packages }])
        await GraphTestHelper.Flush()
        expect(dialogs.Shown.map((d) => d.Title)).toEqual(['Contributed to graph'])
    })

    it('does nothing when the target prompt is cancelled', async () =>
    {
        const contributor = new FakeContributor(Result)
        const work = GraphTestHelper.Work()
        const c = new ContributeToGraphContributor(new Solution('S'), new FakeBuilder(Packages) as any, work, contributor, undefined, new FakePrompt(undefined))
        c.Resolve('graph.contribute', {} as any)!.Execute()
        await GraphTestHelper.Flush()
        expect(work.task).toBeUndefined()
        expect(contributor.Contributions).toEqual([])
    })

    it('fails the task with the build error reason', async () =>
    {
        const builder = new FakeBuilder(Packages, new Error('build boom'))
        const contributor = new FakeContributor(Result)
        const work = GraphTestHelper.Work()
        const c = new ContributeToGraphContributor(new Solution('S'), builder as any, work, contributor, undefined, new FakePrompt(Input))
        c.Resolve('graph.contribute', {} as any)!.Execute()
        await GraphTestHelper.Flush()
        await expect(work.task).rejects.toThrow('build boom')
        expect(contributor.Contributions).toEqual([])
    })

    it('propagates a contributor refusal as the task reason', async () =>
    {
        const contributor = new FakeContributor(Result).FailContribute(new Error('The environment dev is not running. Start it from the tenant console.'))
        const work = GraphTestHelper.Work()
        const c = new ContributeToGraphContributor(new Solution('S'), new FakeBuilder(Packages) as any, work, contributor, undefined, new FakePrompt(Input))
        c.Resolve('graph.contribute', {} as any)!.Execute()
        await GraphTestHelper.Flush()
        await expect(work.task).rejects.toThrow('The environment dev is not running. Start it from the tenant console.')
    })

    it('surfaces a prompt failure via InfoDialog without running the task', async () =>
    {
        const contributor = new FakeContributor(Result)
        const dialogs = new FakeDialogs()
        const work = GraphTestHelper.Work()
        const c = new ContributeToGraphContributor(new Solution('S'), new FakeBuilder(Packages) as any, work, contributor, dialogs as any, new FakePrompt(new Error('prompt broke')))
        c.Resolve('graph.contribute', {} as any)!.Execute()
        await GraphTestHelper.Flush()
        expect(work.task).toBeUndefined()
        expect(dialogs.Shown).toHaveLength(1)
        expect(dialogs.Shown[0]!.Content.Message).toBe('prompt broke')
    })

    it('is disabled without active deps, offers no configure command and ignores unknown command ids', () =>
    {
        const contributor = new FakeContributor(Result)
        const prompt = new FakePrompt(Input)
        const noBuilder = new ContributeToGraphContributor(new Solution('S'), undefined, GraphTestHelper.Work(), contributor, undefined, prompt)
        expect(noBuilder.Resolve('graph.contribute', {} as any)!.CanExecute()).toBe(false)
        const noContributor = new ContributeToGraphContributor(new Solution('S'), new FakeBuilder(Packages) as any, GraphTestHelper.Work(), undefined, undefined, prompt)
        expect(noContributor.Resolve('graph.contribute', {} as any)!.CanExecute()).toBe(false)
        const noWork = new ContributeToGraphContributor(new Solution('S'), new FakeBuilder(Packages) as any, undefined, contributor, undefined, prompt)
        expect(noWork.Resolve('graph.contribute', {} as any)!.CanExecute()).toBe(false)
        expect(noBuilder.Actions.map((a) => a.Id)).toEqual(['graph.contribute'])
        expect(noBuilder.Resolve('graph.configure', {} as any)).toBeUndefined()
        expect(noBuilder.Resolve('nope', {} as any)).toBeUndefined()
    })
})
