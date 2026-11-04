import { describe, it, expect } from 'vitest'
import { Solution } from '@pragmatic-tech-ai/todl'
import { ContributeToGraphContributor } from '../contribute-to-graph-contributor.js'
import { TargetPickOutcome } from '../target-dialog.js'
import { ScriptedPicker } from './fake-target-sources.js'
import type { TargetChoice } from '../../../../../shared/account-api.js'
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

class FakePrompt extends ScriptedPicker
{
    constructor(input: TargetChoice | undefined | Error)
    {
        super([ScriptedPicker.PickOf(input)])
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
        const w: any = { run: (t: string, fn: any) => { w.Title = t; w.task = fn({}); return { handle: {}, done: w.task } } }
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
    const Result: GraphContributeResult = { GraphName: 'main', PackageCount: 1 }
    const Packages: ContributedPackage[] = [{ id: 'orders', version: '1.0.0', modelJson: '{}' }]
    const Input: TargetChoice = { Environment: 'dev', GraphName: 'main' }

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
        expect(contributor.Contributions).toEqual([{ environment: 'dev', graphName: 'main', solutionId: 'S', packages: Packages }])
        expect(work.Title).toBe('Contributing S to graph main in dev')
        await GraphTestHelper.Flush()
        expect(dialogs.Shown.map((d) => d.Title)).toEqual(['Contributed to graph'])
        expect(dialogs.Shown[0]!.Content.Message).toBe('main in dev - packages contributed: 1')
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

    it('opens the account dialog on Sign in, then shows the picker again once signed in', async () =>
    {
        const contributor = new FakeContributor(Result)
        const work = GraphTestHelper.Work()
        const picker = new ScriptedPicker([{ Outcome: TargetPickOutcome.SignIn }, ScriptedPicker.PickOf(Input)])
        picker.SignInResult = true
        const c = new ContributeToGraphContributor(new Solution('S'), new FakeBuilder(Packages) as any, work, contributor, undefined, picker)
        c.Resolve('graph.contribute', {} as any)!.Execute()
        await GraphTestHelper.Flush()
        expect(picker.SignInRequests).toBe(1)
        expect(picker.Shows).toBe(2)
        await expect(work.task).resolves.toEqual(Result)
        expect(contributor.Contributions.map((x) => [x.environment, x.graphName])).toEqual([['dev', 'main']])
    })

    it('stops quietly when the account dialog closes without a sign-in', async () =>
    {
        const contributor = new FakeContributor(Result)
        const work = GraphTestHelper.Work()
        const picker = new ScriptedPicker([{ Outcome: TargetPickOutcome.SignIn }, ScriptedPicker.PickOf(Input)])
        const c = new ContributeToGraphContributor(new Solution('S'), new FakeBuilder(Packages) as any, work, contributor, undefined, picker)
        c.Resolve('graph.contribute', {} as any)!.Execute()
        await GraphTestHelper.Flush()
        expect(picker.SignInRequests).toBe(1)
        expect(picker.Shows).toBe(1)
        expect(work.task).toBeUndefined()
    })

    it('contributes nothing when the picker resolves without a graph', async () =>
    {
        const contributor = new FakeContributor(Result)
        const work = GraphTestHelper.Work()
        const c = new ContributeToGraphContributor(new Solution('S'), new FakeBuilder(Packages) as any, work, contributor, undefined, new FakePrompt({ Environment: 'dev' }))
        c.Resolve('graph.contribute', {} as any)!.Execute()
        await GraphTestHelper.Flush()
        expect(work.task).toBeUndefined()
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
        const noPicker = new ContributeToGraphContributor(new Solution('S'), new FakeBuilder(Packages) as any, GraphTestHelper.Work(), contributor, undefined, undefined)
        expect(noPicker.Resolve('graph.contribute', {} as any)!.CanExecute()).toBe(false)
        expect(noBuilder.Actions.map((a) => a.Id)).toEqual(['graph.contribute'])
        expect(noBuilder.Resolve('graph.configure', {} as any)).toBeUndefined()
        expect(noBuilder.Resolve('nope', {} as any)).toBeUndefined()
    })
})
