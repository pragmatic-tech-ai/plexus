import { describe, it, expect } from 'vitest'
import { Observable } from '@pragmatic-tech-ai/todl-runtime'
import { Solution } from '@pragmatic-tech-ai/todl'
import { TargetSource, type TargetChoice, type TargetRef } from '../../../../../shared/account-api.js'
import { OpenFromEnvironmentFlow, type IOpenFromEnvManager, type IOpenFromEnvSession } from '../open-from-environment-flow.js'
import { SolutionOriginRegistry } from '../solution-origin-registry.js'
import { SolutionOriginKind } from '../solution-origin.js'
import { ScriptedPicker } from './fake-target-sources.js'

class FakeSession implements IOpenFromEnvSession
{
    public FailOn: string | undefined = undefined

    public constructor(private readonly log: string[])
    {
    }

    public Open(target: TargetRef): Promise<void> { return this.Step(`open:${target.Name}`, 'open') }
    public Close(): Promise<void> { return this.Step('close', 'close') }
    public SelectAuthoring(id: string): Promise<unknown> { return this.Step(`select:${id}`, 'select') }

    private Step(entry: string, kind: string): Promise<void>
    {
        this.log.push(entry)
        return this.FailOn === kind ? Promise.reject(new Error(`${kind} boom`)) : Promise.resolve()
    }
}

class FakeManager extends Observable implements IOpenFromEnvManager
{
    public Opened: Solution | undefined = undefined
    public OpenError: Error | undefined = undefined
    // True when the engine declines to replace the current solution (a discard prompt answered No).
    public Decline = false
    private active: Solution | undefined

    public constructor(private readonly log: string[])
    {
        super()
    }

    public get ActiveSolution(): Solution | undefined { return this.active }

    public Swap(next: Solution | undefined): void
    {
        const old = this.active
        this.active = next
        this.RaisePropertyChanged('ActiveSolution', old, next)
    }

    public async OpenSolution(location: string): Promise<void>
    {
        this.log.push(`opensolution:${location}`)
        if (this.OpenError !== undefined) throw this.OpenError
        if (this.Decline) return
        this.Opened = new Solution('S')
        this.Swap(this.Opened)
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

class Rig
{
    public readonly Log: string[] = []
    public readonly Registry = new SolutionOriginRegistry()
    public readonly Session = new FakeSession(this.Log)
    public readonly Manager = new FakeManager(this.Log)
    public readonly Dialogs = new FakeDialogs()

    public Flow(input: TargetChoice | undefined | Error): OpenFromEnvironmentFlow
    {
        return new OpenFromEnvironmentFlow(new ScriptedPicker([ScriptedPicker.PickOf(input)]), this.Session, this.Manager, this.Registry, this.Dialogs as any)
    }
}

describe('OpenFromEnvironmentFlow', () =>
{
    const Choice: TargetChoice = { Environment: 'dev', Source: TargetSource.Platform, SolutionName: 'orders' }

    it('binds the session, selects authoring, then opens the dev-environment location, in that order', async () =>
    {
        const rig = new Rig()
        await rig.Flow(Choice).Run()
        expect(rig.Log).toEqual(['open:dev', 'select:orders', 'opensolution:dev-environment://dev/orders'])
    })

    it('registers a DevEnvironment origin on the opened solution', async () =>
    {
        const rig = new Rig()
        let signalled = 0
        rig.Registry.Changed.subscribe(() => { signalled++ })
        await rig.Flow(Choice).Run()
        const origin = rig.Registry.Get(rig.Manager.Opened!)
        expect(origin?.Kind).toBe(SolutionOriginKind.DevEnvironment)
        expect(origin?.EnvironmentRef).toEqual({ Name: 'dev', Source: TargetSource.Platform })
        expect(origin?.SolutionName).toBe('orders')
        expect(signalled).toBe(1)
    })

    it('signals the registry change after the solution is active, so earlier activation listeners can refresh', async () =>
    {
        const rig = new Rig()
        const seen: boolean[] = []
        rig.Registry.Changed.subscribe(() => { seen.push(rig.Manager.ActiveSolution !== undefined && rig.Registry.Get(rig.Manager.ActiveSolution) !== undefined) })
        await rig.Flow(Choice).Run()
        expect(seen).toEqual([true])
    })

    it('unregisters the origin when another solution replaces it', async () =>
    {
        const rig = new Rig()
        await rig.Flow(Choice).Run()
        const opened = rig.Manager.Opened!
        rig.Manager.Swap(new Solution('Other'))
        expect(rig.Registry.Get(opened)).toBeUndefined()
    })

    it('unregisters the origin when the solution is closed', async () =>
    {
        const rig = new Rig()
        await rig.Flow(Choice).Run()
        const opened = rig.Manager.Opened!
        rig.Manager.Swap(undefined)
        expect(rig.Registry.Get(opened)).toBeUndefined()
    })

    it('does nothing when the picker is cancelled', async () =>
    {
        const rig = new Rig()
        await rig.Flow(undefined).Run()
        expect(rig.Log).toEqual([])
    })

    it('does nothing when no solution was chosen', async () =>
    {
        const rig = new Rig()
        await rig.Flow({ Environment: 'dev' }).Run()
        expect(rig.Log).toEqual([])
    })

    it('surfaces a picker failure without touching the session', async () =>
    {
        const rig = new Rig()
        await rig.Flow(new Error('picker boom')).Run()
        expect(rig.Log).toEqual([])
        expect(rig.Dialogs.Shown[0]!.Content.Message).toBe('picker boom')
    })

    it('stops at a failed session bind: nothing opens, the session is closed, the error is shown', async () =>
    {
        const rig = new Rig()
        rig.Session.FailOn = 'open'
        await rig.Flow(Choice).Run()
        expect(rig.Log).toEqual(['open:dev', 'close'])
        expect(rig.Dialogs.Shown.map((d) => d.Content.Message)).toEqual(['open boom'])
    })

    it('stops at a failed authoring selection and closes the session', async () =>
    {
        const rig = new Rig()
        rig.Session.FailOn = 'select'
        await rig.Flow(Choice).Run()
        expect(rig.Log).toEqual(['open:dev', 'select:orders', 'close'])
        expect(rig.Manager.Opened).toBeUndefined()
        expect(rig.Dialogs.Shown[0]!.Content.Message).toBe('select boom')
    })

    it('rolls back when the engine open fails: session closed, no origin, error shown', async () =>
    {
        const rig = new Rig()
        rig.Manager.OpenError = new Error('read boom')
        await rig.Flow(Choice).Run()
        expect(rig.Log).toEqual(['open:dev', 'select:orders', 'opensolution:dev-environment://dev/orders', 'close'])
        expect(rig.Dialogs.Shown[0]!.Content.Message).toBe('read boom')
    })

    it('closes the session quietly when the engine declines to replace the current solution', async () =>
    {
        const rig = new Rig()
        rig.Manager.Decline = true
        await rig.Flow(Choice).Run()
        expect(rig.Log.at(-1)).toBe('close')
        expect(rig.Dialogs.Shown).toEqual([])
    })

    it('restores the session to a still-open dev solution when the replace is declined', async () =>
    {
        const rig = new Rig()
        const current = new Solution('Current')
        rig.Manager.Swap(current)
        rig.Registry.Register(current, { Name: 'prod', Source: TargetSource.Console }, 'billing')
        rig.Manager.Decline = true
        await rig.Flow(Choice).Run()
        expect(rig.Log.slice(-2)).toEqual(['open:prod', 'select:billing'])
        expect(rig.Registry.Get(current)).toBeDefined()
    })

    it('keeps a previously open dev solution registered when a new open fails', async () =>
    {
        const rig = new Rig()
        const current = new Solution('Current')
        rig.Manager.Swap(current)
        rig.Registry.Register(current, { Name: 'prod', Source: TargetSource.Console }, 'billing')
        rig.Manager.OpenError = new Error('boom')
        await rig.Flow(Choice).Run()
        expect(rig.Registry.Get(current)).toBeDefined()
    })
})
