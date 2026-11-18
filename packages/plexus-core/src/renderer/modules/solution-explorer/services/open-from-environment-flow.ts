import type { Signal, PropertyChangedEventArgs } from '@pragmatic-tech-ai/todl-runtime'
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

// The part of the engine's solution manager the flow drives (SolutionManagerService satisfies it).
export interface IOpenFromEnvManager
{
    readonly ActiveSolution: Solution | undefined;
    OpenSolution(location: string): Promise<void>;
    PropertyChanged(name: string): Signal<PropertyChangedEventArgs>;
}

// "Open from dev environment": pick an environment + solution, bind the held dev session to the
// environment, route authoring to the solution, open it through the engine from its
// dev-environment:// location, and record its origin so the services switch to Remote. The session
// is bound and authoring selected BEFORE the engine reads storage; the origin is registered the
// moment the opened Solution becomes active. When the solution later stops being active its origin
// is unregistered. Any failure rolls the session back (no half-open state) and is shown in a dialog.
export class OpenFromEnvironmentFlow
{
    private static readonly ActiveSolutionProperty = 'ActiveSolution'
    private static readonly OpenFailedTitle = 'Open from dev environment failed'

    public constructor(
        private readonly picker: ITargetPicker,
        private readonly session: IOpenFromEnvSession,
        private readonly manager: IOpenFromEnvManager,
        private readonly registry: SolutionOriginRegistry,
        private readonly dialogs: DialogService | undefined)
    {
    }

    public async Run(): Promise<void>
    {
        let choice: TargetChoice | undefined
        try
        {
            choice = await TargetPickerFlow.Choose(this.picker)
        }
        catch (e)
        {
            await this.Surface(e)
            return
        }
        if (choice === undefined || choice.SolutionName === undefined) return
        await this.Open(TargetIdentity.RefOf(choice), choice.SolutionName)
    }

    private async Open(env: TargetRef, solutionName: string): Promise<void>
    {
        const previous = this.manager.ActiveSolution
        let opened: Solution | undefined
        const watch = this.manager.PropertyChanged(OpenFromEnvironmentFlow.ActiveSolutionProperty).subscribe(() =>
        {
            const active = this.manager.ActiveSolution
            if (opened === undefined)
            {
                if (active === undefined || active === previous) return
                opened = active
                this.registry.Register(active, env, solutionName)
            }
            else if (active !== opened)
            {
                this.registry.Unregister(opened)
                watch.dispose()
            }
        })
        try
        {
            await this.session.Open(env)
            await this.session.SelectAuthoring(solutionName)
            await this.manager.OpenSolution(DevEnvironmentLocation.Build(env.Name, solutionName))
        }
        catch (e)
        {
            watch.dispose()
            if (opened !== undefined) this.registry.Unregister(opened)
            await this.Rollback(previous)
            await this.Surface(e)
            return
        }
        if (opened === undefined)
        {
            // The engine declined to replace the current solution: nothing opened.
            watch.dispose()
            await this.Rollback(previous)
        }
    }

    // Puts the held session back: re-bound to the still-active dev solution's environment, else closed.
    private async Rollback(previous: Solution | undefined): Promise<void>
    {
        const origin = previous === undefined ? undefined : this.registry.Get(previous)
        try
        {
            if (origin === undefined)
            {
                await this.session.Close()
            }
            else
            {
                await this.session.Open(origin.EnvironmentRef)
                await this.session.SelectAuthoring(origin.SolutionName)
            }
        }
        catch
        {
            // Best effort: the original failure is the one worth showing.
        }
    }

    private async Surface(error: unknown): Promise<void>
    {
        if (this.dialogs === undefined) return
        await InfoDialog.Show(this.dialogs, OpenFromEnvironmentFlow.OpenFailedTitle, error instanceof Error ? error.message : String(error))
    }
}
