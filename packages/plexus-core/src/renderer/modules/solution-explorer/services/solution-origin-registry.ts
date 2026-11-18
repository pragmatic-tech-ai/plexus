import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import { DevEnvironmentLocation } from '../../storage/dev-environment-location.js'
import { RemoteFileStorage } from '../../storage/remote-file-storage.js'
import type { Solution } from '@pragmatic-tech-ai/todl'
import type { TargetRef } from '../../../../shared/account-api.js'
import { SolutionOriginKind, type DevEnvironmentOrigin } from './solution-origin.js'

// Records which open solutions were opened from a dev environment. The open-from-environment flow
// calls Register once the solution is open; SolutionOrigins.Of and the services selector read it.
// Keyed by the Solution object identity (weakly, so a closed solution drops its entry).
export class SolutionOriginRegistry
{
    public static readonly Key = new ServiceKey<SolutionOriginRegistry>('SolutionOriginRegistry')

    private readonly origins = new WeakMap<Solution, DevEnvironmentOrigin>()
    private expected: { readonly Root: string, readonly Ref: TargetRef, readonly SolutionName: string } | undefined

    public Register(solution: Solution, ref: TargetRef, solutionName: string): DevEnvironmentOrigin
    {
        const origin: DevEnvironmentOrigin = {
            Kind: SolutionOriginKind.DevEnvironment,
            EnvironmentName: ref.Name,
            EnvironmentRef: ref,
            SolutionName: solutionName,
        }
        this.origins.set(solution, origin)
        return origin
    }

    public Unregister(solution: Solution): void
    {
        this.origins.delete(solution)
    }

    // Announces the dev-environment solution about to be opened, by its location, BEFORE the engine opens
    // it: the first Get of the Solution it produces (the engine activation rebuild) then already resolves
    // the origin, with no window in which the solution looks local.
    public ExpectOpen(location: string, ref: TargetRef, solutionName: string): void
    {
        this.expected = { Root: DevEnvironmentLocation.RootOf(location), Ref: ref, SolutionName: solutionName }
    }

    public CancelExpected(): void
    {
        this.expected = undefined
    }

    public Get(solution: Solution): DevEnvironmentOrigin | undefined
    {
        return this.origins.get(solution) ?? this.Adopt(solution)
    }

    // A solution rooted in the remote storage of the expected location IS the expected open: it takes the
    // origin (once), keyed by its own identity from then on.
    private Adopt(solution: Solution): DevEnvironmentOrigin | undefined
    {
        const expected = this.expected
        const storage = solution.Storage
        if (expected === undefined || !(storage instanceof RemoteFileStorage) || storage.Root !== expected.Root) return undefined
        this.expected = undefined
        return this.Register(solution, expected.Ref, expected.SolutionName)
    }
}
