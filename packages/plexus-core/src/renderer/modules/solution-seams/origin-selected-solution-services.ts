import type { IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { SolutionLanguageService } from '@pragmatic-tech-ai/todl'
import type { Solution } from '@pragmatic-tech-ai/todl'
import { SolutionOriginRegistry } from '../solution-explorer/services/solution-origin-registry.js'
import { DevStorageSessionKeys } from '../storage/dev-storage-session-key.js'
import { IntegratedSolutionServices } from './integrated-solution-services.js'
import { SolutionServices, type ISolutionServices } from './solution-services.js'
import { RemoteSolutionServices } from './remote/remote-solution-services.js'
import type { ILocalBaseResolution } from './remote/remote-language-service.js'

// The ISolutionServices registered under SolutionServices.Key: each access picks the implementation
// for the ACTIVE solution's origin. A solution registered as opened from a dev environment gets
// RemoteSolutionServices (built once per solution, over the held dev session and the in-proc
// SolutionLanguageService as the local base resolver); anything else gets IntegratedSolutionServices.
export class OriginSelectedSolutionServices implements ISolutionServices
{
    // Registering this class in a .mu `.services:` block files it under the SolutionServices token.
    public static readonly Key = SolutionServices.Key

    private readonly integrated: IntegratedSolutionServices
    private remote: { readonly Solution: Solution, readonly Services: RemoteSolutionServices } | undefined

    public constructor(private readonly provider: IServiceProvider)
    {
        this.integrated = new IntegratedSolutionServices(provider)
    }

    // The implementation serving the active solution right now.
    public get Current(): ISolutionServices
    {
        const solution = this.integrated.Manager.ActiveSolution
        const registry = this.provider.get(SolutionOriginRegistry.Key)
        if (solution === undefined || registry?.Get(solution) === undefined)
        {
            this.DisposeRemote()
            return this.integrated
        }
        if (this.remote?.Solution !== solution)
        {
            this.DisposeRemote()
            this.remote = { Solution: solution, Services: this.CreateRemote() }
        }
        return this.remote.Services
    }

    public get Manager(): ISolutionServices['Manager'] { return this.Current.Manager }
    public get Language(): ISolutionServices['Language'] { return this.Current.Language }
    public get Build(): ISolutionServices['Build'] { return this.Current.Build }
    public get Storage(): ISolutionServices['Storage'] { return this.Current.Storage }

    // Drops the cached Remote, releasing its session subscriptions.
    private DisposeRemote(): void
    {
        this.remote?.Services.dispose()
        this.remote = undefined
    }

    private CreateRemote(): RemoteSolutionServices
    {
        const session = this.provider.getRequired(DevStorageSessionKeys.Session)
        // SolutionLanguageService is an IBaseResolver with StaleMembers + PropertyChanged(name): it IS the local half.
        const localBase: ILocalBaseResolution = this.provider.getRequired(SolutionLanguageService.Key)
        return new RemoteSolutionServices(this.provider, session, localBase)
    }
}
