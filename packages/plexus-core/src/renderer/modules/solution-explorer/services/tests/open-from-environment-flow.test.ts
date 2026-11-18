import { describe, it, expect } from 'vitest'
import { Observable } from '@pragmatic-tech-ai/todl-runtime'
import { Solution } from '@pragmatic-tech-ai/todl'
import { TargetSource, type TargetChoice, type TargetRef } from '../../../../../shared/account-api.js'
import { DevEnvironmentLocation } from '../../../storage/dev-environment-location.js'
import { RemoteFileStorage, type IDevStorageSession } from '../../../storage/remote-file-storage.js'
import { OpenFromEnvironmentFlow, type IOpenFromEnvManager, type IOpenFromEnvSession } from '../open-from-environment-flow.js'
import { SolutionOriginRegistry } from '../solution-origin-registry.js'
import { SolutionOriginKind, SolutionOrigins } from '../solution-origin.js'
import type { ITargetPicker, TargetPick } from '../target-dialog.js'
import { Gate, ScriptedPicker } from './fake-target-sources.js'

class FakeSession implements IOpenFromEnvSession
{
    public FailOn: string | undefined = undefined
    public CloseGate: Gate<void> | undefined = undefined

    public constructor(private readonly log: string[])
    {
    }

    public Open(target: TargetRef): Promise<void> { return this.Step(`open:${target.Name}`, 'open') }
    public async Close(): Promise<void>
    {
        await this.Step('close', 'close')
        if (this.CloseGate === undefined) return
        await this.CloseGate.Promise
        this.log.push('closed')
    }

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
    // When set, OpenSolution throws only AFTER the new solution became active.
    public ThrowAfterActivation = false
    // Runs inside OpenSolution just before the new solution is created (a late reader of an old solution).
    public DuringOpen: (() => void) | undefined = undefined
    // True when the engine declines to replace the current solution (a discard prompt answered No).
    public Decline = false
    // Gates / refuses CloseSolution, standing for the dirty-discard prompt.
    public CloseGate: Gate<void> | undefined = undefined
    public RefuseClose = false
    public Closes = 0
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

    public async CloseSolution(): Promise<void>
    {
        this.Closes++
        this.log.push('closesolution')
        if (this.CloseGate !== undefined) await this.CloseGate.Promise
        if (this.RefuseClose) return
        this.Swap(undefined)
    }

    public async OpenSolution(location: string): Promise<void>
    {
        this.log.push(`opensolution:${location}`)
        if (this.OpenError !== undefined) throw this.OpenError
        if (this.Decline) return
        this.DuringOpen?.()
        const root = DevEnvironmentLocation.RootOf(location)
        this.Opened = new Solution(root, new RemoteFileStorage({} as IDevStorageSession, root))
        this.Swap(this.Opened)
        if (this.ThrowAfterActivation) throw new Error('after boom')
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

class GatedPicker implements ITargetPicker
{
    public readonly Gate = new Gate<TargetPick>()

    public Show(): Promise<TargetPick> { return this.Gate.Promise }
    public RequestSignIn(): Promise<boolean> { return Promise.resolve(false) }
}

class Rig
{
    public readonly Log: string[] = []
    public readonly Registry = new SolutionOriginRegistry()
    public readonly Session = new FakeSession(this.Log)
    public readonly Manager = new FakeManager(this.Log)
    public readonly Dialogs = new FakeDialogs()
    public readonly Created: ITargetPicker[] = []

    // One flow per rig; each Run gets the next answer (the last one repeats).
    public Flow(...inputs: Array<TargetChoice | undefined | Error>): OpenFromEnvironmentFlow
    {
        return new OpenFromEnvironmentFlow(
            () =>
            {
                const picker = new ScriptedPicker([ScriptedPicker.PickOf(inputs[Math.min(this.Created.length, inputs.length - 1)])])
                this.Created.push(picker)
                return picker
            },
            this.Session, this.Manager, this.Registry, this.Dialogs as any)
    }
}

describe('OpenFromEnvironmentFlow', () =>
{
    const Choice: TargetChoice = { Environment: 'dev', Source: TargetSource.Platform, SolutionName: 'orders' }
    const Other: TargetChoice = { Environment: 'prod', Source: TargetSource.Console, SolutionName: 'billing' }

    // A tick for the fire-and-forget session close the watcher starts.
    const Settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

    it('binds the session, selects authoring, then opens the dev-environment location, in that order', async () =>
    {
        const rig = new Rig()
        await rig.Flow(Choice).Run()
        expect(rig.Log).toEqual(['open:dev', 'select:orders', 'opensolution:dev-environment://dev/orders'])
    })

    it('registers a DevEnvironment origin on the opened solution', async () =>
    {
        const rig = new Rig()
        await rig.Flow(Choice).Run()
        const origin = rig.Registry.Get(rig.Manager.Opened!)
        expect(origin?.Kind).toBe(SolutionOriginKind.DevEnvironment)
        expect(origin?.EnvironmentRef).toEqual({ Name: 'dev', Source: TargetSource.Platform })
        expect(origin?.SolutionName).toBe('orders')
    })

    it('resolves the dev origin on the FIRST activation, before any later listener or the final registration', async () =>
    {
        const rig = new Rig()
        const seen: SolutionOriginKind[] = []
        rig.Manager.PropertyChanged('ActiveSolution').subscribe(() =>
        {
            if (rig.Manager.ActiveSolution !== undefined) seen.push(SolutionOrigins.Of(rig.Manager.ActiveSolution, rig.Registry).Kind)
        })
        await rig.Flow(Choice).Run()
        expect(seen).toEqual([SolutionOriginKind.DevEnvironment])
    })

    it('does not mislabel a local solution that activates while nothing is expected', () =>
    {
        const rig = new Rig()
        expect(rig.Registry.Get(new Solution('Local'))).toBeUndefined()
    })

    it('closes the held session and drops the origin when the dev solution is closed', async () =>
    {
        const rig = new Rig()
        await rig.Flow(Choice).Run()
        const opened = rig.Manager.Opened!
        rig.Manager.Swap(undefined)
        await Settle()
        expect(rig.Registry.Get(opened)).toBeUndefined()
        expect(rig.Log).toContain('close')
    })

    it('raises Unregistered for the opened solution as the flow closes the session, without any later read', async () =>
    {
        const rig = new Rig()
        await rig.Flow(Choice).Run()
        const opened = rig.Manager.Opened!
        const retired: unknown[] = []
        rig.Registry.Unregistered.subscribe(s => retired.push(s))
        rig.Manager.Swap(undefined)
        await Settle()
        expect(retired).toEqual([opened])
    })

    it('closes the held session when a local solution replaces the dev solution', async () =>
    {
        const rig = new Rig()
        await rig.Flow(Choice).Run()
        const opened = rig.Manager.Opened!
        rig.Manager.Swap(new Solution('Local'))
        await Settle()
        expect(rig.Registry.Get(opened)).toBeUndefined()
        expect(rig.Log).toContain('close')
    })

    it('does not close the session the next environment owns when one dev solution replaces another', async () =>
    {
        const rig = new Rig()
        const flow = rig.Flow(Choice, Other)
        await flow.Run()
        const first = rig.Manager.Opened!
        await flow.Run()
        await Settle()
        expect(rig.Log.filter((e) => e === 'close')).toEqual([])
        expect(rig.Log.slice(-3)).toEqual(['open:prod', 'select:billing', 'opensolution:dev-environment://prod/billing'])
        expect(rig.Registry.Get(first)).toBeUndefined()
        expect(rig.Registry.Get(rig.Manager.Opened!)?.EnvironmentName).toBe('prod')
        // And closing that one then releases the session.
        rig.Manager.Swap(undefined)
        await Settle()
        expect(rig.Log).toContain('close')
    })

    it('keeps the previous dev solution on its own environment while the replace prompt is open', async () =>
    {
        const rig = new Rig()
        const flow = rig.Flow(Choice, Other)
        await flow.Run()
        const first = rig.Manager.Opened!
        rig.Log.length = 0
        rig.Manager.CloseGate = new Gate<void>()
        const second = flow.Run()
        await Settle()
        // The prompt is pending: the previous solution is still active and the session was not re-bound.
        expect(rig.Manager.ActiveSolution).toBe(first)
        expect(rig.Log).toEqual(['closesolution'])
        rig.Manager.CloseGate.Resolve()
        await second
        expect(rig.Log).toEqual(['closesolution', 'open:prod', 'select:billing', 'opensolution:dev-environment://prod/billing'])
    })

    it('leaves everything untouched when the replace prompt is declined', async () =>
    {
        const rig = new Rig()
        const flow = rig.Flow(Choice, Other)
        await flow.Run()
        const first = rig.Manager.Opened!
        rig.Log.length = 0
        rig.Manager.RefuseClose = true
        await flow.Run()
        expect(rig.Log).toEqual(['closesolution'])
        expect(rig.Manager.ActiveSolution).toBe(first)
        expect(rig.Registry.Get(first)).toBeDefined()
        expect(rig.Dialogs.Shown).toEqual([])
    })

    it('adopts the NEW solution, not a retired one that reuses its name, even when the old one is read mid-open', async () =>
    {
        const rig = new Rig()
        const flow = rig.Flow(Choice, Choice)
        await flow.Run()
        const first = rig.Manager.Opened!
        const seen: SolutionOriginKind[] = []
        rig.Manager.DuringOpen = () => { expect(rig.Registry.Get(first)).toBeUndefined() }
        rig.Manager.PropertyChanged('ActiveSolution').subscribe(() =>
        {
            if (rig.Manager.ActiveSolution !== undefined) seen.push(SolutionOrigins.Of(rig.Manager.ActiveSolution, rig.Registry).Kind)
        })
        await flow.Run()
        expect(rig.Manager.Opened).not.toBe(first)
        expect(seen).toEqual([SolutionOriginKind.DevEnvironment])
        expect(rig.Registry.Get(first)).toBeUndefined()
    })

    it('adopts the new solution when a same-named solution of a different environment replaces it', async () =>
    {
        const rig = new Rig()
        const flow = rig.Flow(Choice, { Environment: 'prod', Source: TargetSource.Console, SolutionName: 'orders' })
        await flow.Run()
        const first = rig.Manager.Opened!
        rig.Manager.DuringOpen = () => { rig.Registry.Get(first) }
        await flow.Run()
        expect(rig.Registry.Get(rig.Manager.Opened!)?.EnvironmentName).toBe('prod')
        expect(rig.Registry.Get(first)).toBeUndefined()
    })

    it('waits for a pending session close before binding the next open', async () =>
    {
        const rig = new Rig()
        const flow = rig.Flow(Choice, Other)
        await flow.Run()
        rig.Log.length = 0
        rig.Session.CloseGate = new Gate<void>()
        rig.Manager.Swap(undefined)
        const next = flow.Run()
        await Settle()
        expect(rig.Log).toEqual(['close'])
        rig.Session.CloseGate.Resolve()
        await next
        expect(rig.Log).toEqual(['close', 'closed', 'open:prod', 'select:billing', 'opensolution:dev-environment://prod/billing'])
    })

    it('stops watching once disposed', async () =>
    {
        const rig = new Rig()
        const flow = rig.Flow(Choice)
        await flow.Run()
        flow.dispose()
        rig.Log.length = 0
        rig.Manager.Swap(undefined)
        await Settle()
        expect(rig.Log).toEqual([])
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

    it('rolls back when the engine open fails: session closed, error shown, nothing expected any more', async () =>
    {
        const rig = new Rig()
        rig.Manager.OpenError = new Error('read boom')
        await rig.Flow(Choice).Run()
        expect(rig.Log).toEqual(['open:dev', 'select:orders', 'opensolution:dev-environment://dev/orders', 'close'])
        expect(rig.Dialogs.Shown[0]!.Content.Message).toBe('read boom')
        const stray = new Solution('orders', new RemoteFileStorage({} as IDevStorageSession, 'orders'))
        expect(rig.Registry.Get(stray)).toBeUndefined()
    })

    it('closes the solution again when the engine open throws AFTER it became active', async () =>
    {
        const rig = new Rig()
        rig.Manager.ThrowAfterActivation = true
        await rig.Flow(Choice).Run()
        expect(rig.Manager.ActiveSolution).toBeUndefined()
        expect(rig.Registry.Get(rig.Manager.Opened!)).toBeUndefined()
        expect(rig.Log).toEqual(['open:dev', 'select:orders', 'opensolution:dev-environment://dev/orders', 'closesolution', 'close'])
        expect(rig.Dialogs.Shown[0]!.Content.Message).toBe('after boom')
    })

    it('closes the session quietly when the engine declines to replace a local solution', async () =>
    {
        const rig = new Rig()
        rig.Manager.Swap(new Solution('Local'))
        rig.Manager.Decline = true
        await rig.Flow(Choice).Run()
        expect(rig.Log).toContain('close')
        expect(rig.Dialogs.Shown).toEqual([])
    })

    it('ignores a second invocation while one is in flight', async () =>
    {
        const rig = new Rig()
        const picker = new GatedPicker()
        const flow = new OpenFromEnvironmentFlow(() => { rig.Created.push(picker); return picker }, rig.Session, rig.Manager, rig.Registry, rig.Dialogs as any)
        const first = flow.Run()
        await flow.Run()
        expect(rig.Created).toHaveLength(1)
        expect(flow.IsRunning).toBe(true)
        picker.Gate.Resolve(ScriptedPicker.PickOf(undefined) as TargetPick)
        await first
        expect(flow.IsRunning).toBe(false)
    })
})
