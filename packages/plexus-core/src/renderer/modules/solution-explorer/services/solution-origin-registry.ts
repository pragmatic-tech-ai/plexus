import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import { Signal } from '@pragmatic-tech-ai/todl-runtime'
import type { Solution } from '@pragmatic-tech-ai/todl'
import type { TargetRef } from '../../../../shared/account-api.js'
import { SolutionOriginKind, type DevEnvironmentOrigin } from './solution-origin.js'

// Records which open solutions were opened from a dev environment. The open-from-environment flow
// calls Register once the solution is open; SolutionOrigins.Of and the services selector read it.
// Keyed by the Solution object identity (weakly, so a closed solution drops its entry).
export class SolutionOriginRegistry
{
    public static readonly Key = new ServiceKey<SolutionOriginRegistry>('SolutionOriginRegistry')

    // Raised after every Register / Unregister, so views derived from the origin (the services
    // selection, the explorer header, the window title) can refresh.
    public readonly Changed = new Signal<void>()

    private readonly origins = new WeakMap<Solution, DevEnvironmentOrigin>()

    public Register(solution: Solution, ref: TargetRef, solutionName: string): DevEnvironmentOrigin
    {
        const origin: DevEnvironmentOrigin = {
            Kind: SolutionOriginKind.DevEnvironment,
            EnvironmentName: ref.Name,
            EnvironmentRef: ref,
            SolutionName: solutionName,
        }
        this.origins.set(solution, origin)
        this.Changed.emit()
        return origin
    }

    public Unregister(solution: Solution): void
    {
        if (this.origins.delete(solution)) this.Changed.emit()
    }

    public Get(solution: Solution): DevEnvironmentOrigin | undefined
    {
        return this.origins.get(solution)
    }
}
