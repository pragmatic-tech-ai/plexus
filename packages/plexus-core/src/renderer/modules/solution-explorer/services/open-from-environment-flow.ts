import type { Signal, PropertyChangedEventArgs, IDisposable } from '@pragmatic-tech-ai/todl-runtime'
import type { Solution } from '@pragmatic-tech-ai/todl'
import type { DialogService } from '@pragmatic-tech-ai/mural/framework'
import { TargetIdentity, type TargetChoice, type TargetRef } from '../../../../shared/account-api.js'
import { DevEnvironmentLocation } from '../../storage/dev-environment-location.js'
import { InfoDialog } from './info-dialog.js'
import { SolutionOriginRegistry } from './solution-origin-registry.js'
import { TargetPickerFlow, type ITargetPicker } from './target-dialog.js'

// The part of the held dev session the flow drives: bind it to an environment, route its authoring
// to a named solution, and release it again.
export interface IOpenFromEnvSession
{
    Open(target: TargetRef): Promise<void>;
    Close(): Promise<void>;
    SelectAuthoring(solutionId: string): Promise<unknown>;
}

// The part of the engine solution manager the flow drives (SolutionManagerService satisfies it).
export interface IOpenFromEnvManager
{
    readonly ActiveSolution: Solution | undefined;
    OpenSolution(location: string): Promise<void>;
    CloseSolution(): Promise<void>;
    PropertyChanged(name: string): Signal<PropertyChangedEventArgs>;
}

// "Open from dev environment": pick an environment + solution, then open it through the engine from
// its dev-environment:// location over the held dev session.
//
// Ordering: when the solution being replaced is itself a dev solution, it is closed FIRST (the engine
// discard prompt lives there), so the held session is only re-bound once the replace is confirmed and
// the previous solution never talks to the new environment. The expected origin is registered by
// location BEFORE the engine opens, so the very first rebuild triggered by the new active solution
// already resolves the Remote services; the final registration is then keyed by the Solution itself.
//
// Lifetime: one instance lives as long as its owner. It watches the active solution, and once no dev
// solution is active (closed, or replaced by a local one) it unregisters the origin and closes the
// held session. While a Run is in progress the watcher stays quiet, so a back-to-back open never
// closes a session the new environment owns. Any failure rolls back (no half-open state).
export class OpenFromEnvironmentFlow
{
    private static readonly ActiveSolutionProperty = 'ActiveSolution'
    private static readonly OpenFailedTitle = 'Open from dev environment failed'

    private running = false
    private bound = false
    private opened: Solution | undefined
    private watch: IDisposable | undefined
    // The session close the watcher started, if any: the next bind waits for it so it cannot tear that bind down.
    private closing: Promise<void> | undefined

    public constructor(
        private readonly createPicker: () => ITargetPicker,
        private readonly session: IOpenFromEnvSession,
        private readonly manager: IOpenFromEnvManager,
        private readonly registry: SolutionOriginRegistry,
        private readonly dialogs: DialogService | undefined)
    {
    }

    public get IsRunning(): boolean { return this.running }

    // A second invocation while one is in flight is ignored.
    public async Run(): Promise<void>
    {
        if (this.running) return
        this.running = true
        this.EnsureWatching()
        try
        {
            await this.RunOnce()
        }
        finally
        {
            this.running = false
        }
    }

    private async RunOnce(): Promise<void>
    {
        await this.closing
        let choice: TargetChoice | undefined
        try
        {
            choice = await TargetPickerFlow.Choose(this.createPicker())
        }
        catch (e)
        {
            await this.Surface(e)
            return
        }
        if (choice === undefined || choice.SolutionName === undefined) return
        const env = TargetIdentity.RefOf(choice)
        const name = choice.SolutionName
        if (!await this.ReplaceCurrentDevSolution()) return
        const baseline = this.manager.ActiveSolution
        const location = DevEnvironmentLocation.Build(env.Name, name)
        try
        {
            this.bound = true
            await this.session.Open(env)
            await this.session.SelectAuthoring(name)
            this.registry.ExpectOpen(location, env, name)
            await this.manager.OpenSolution(location)
        }
        catch (e)
        {
            this.registry.CancelExpected()
            await this.Abort(baseline)
            await this.Surface(e)
            return
        }
        this.registry.CancelExpected()
        const active = this.manager.ActiveSolution
        if (active === undefined || active === baseline)
        {
            // The engine declined to replace the current solution: nothing opened.
            await this.CloseSession()
            return
        }
        this.registry.Register(active, env, name)
        this.opened = active
    }

    // When the solution being replaced is a dev solution, closes it now (its dirty prompt included) so the
    // session is not re-bound under it. False when the maker declined and it is still open.
    private async ReplaceCurrentDevSolution(): Promise<boolean>
    {
        const previous = this.manager.ActiveSolution
        if (previous === undefined || this.registry.Get(previous) === undefined) return true
        try
        {
            await this.manager.CloseSolution()
        }
        catch (e)
        {
            await this.Surface(e)
            return false
        }
        if (this.manager.ActiveSolution === previous) return false
        this.ForgetOpened()
        this.registry.Unregister(previous)
        return true
    }

    // Rolls a failed open back: a solution that became active is closed again and loses its origin, and the
    // session is released.
    private async Abort(baseline: Solution | undefined): Promise<void>
    {
        const active = this.manager.ActiveSolution
        if (active !== undefined && active !== baseline)
        {
            this.registry.Unregister(active)
            try
            {
                await this.manager.CloseSolution()
            }
            catch
            {
                // Best effort: the original failure is the one worth showing.
            }
        }
        await this.CloseSession()
    }

    private EnsureWatching(): void
    {
        this.watch ??= this.manager.PropertyChanged(OpenFromEnvironmentFlow.ActiveSolutionProperty).subscribe(() => this.OnActiveChanged())
    }

    // Once no dev solution is active (and no Run is mid-flight) the origin goes and the session is released.
    private OnActiveChanged(): void
    {
        if (this.running) return
        const active = this.manager.ActiveSolution
        if (active !== undefined && this.registry.Get(active) !== undefined) return
        this.ForgetOpened()
        if (this.bound) void this.CloseSession()
    }

    private ForgetOpened(): void
    {
        if (this.opened === undefined) return
        this.registry.Unregister(this.opened)
        this.opened = undefined
    }

    private CloseSession(): Promise<void>
    {
        this.bound = false
        const closing = this.CloseQuietly()
        this.closing = closing
        return closing
    }

    private async CloseQuietly(): Promise<void>
    {
        try
        {
            await this.session.Close()
        }
        catch
        {
            // Best effort: nothing more can be done for a session that will not close.
        }
    }

    private async Surface(error: unknown): Promise<void>
    {
        if (this.dialogs === undefined) return
        await InfoDialog.Show(this.dialogs, OpenFromEnvironmentFlow.OpenFailedTitle, error instanceof Error ? error.message : String(error))
    }

    public dispose(): void
    {
        this.watch?.dispose()
        this.watch = undefined
    }
}
