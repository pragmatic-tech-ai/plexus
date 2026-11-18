import type { IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { IBaseResolver, IBuildService, ILanguageService, IManager } from '@pragmatic-tech-ai/todl'
import { BuildService, SolutionManagerService } from '@pragmatic-tech-ai/todl'
import { StorageService } from '../../storage/index.js'
import type { ISolutionServices } from '../solution-services.js'
import { RemoteLanguageService } from './remote-language-service.js'
import type { ILocalBaseResolution, IRemoteLanguageLog, IRemoteLanguageSession } from './remote-language-service.js'
import { SolutionMemberIds } from './solution-member-ids.js'

// The Remote facade: only Language is remote (the environment's shared language service, driven over
// the held develop session). Manager, Build and Storage are the local singletons; they already work
// against the remote storage backend because the solution is opened from a dev-environment:// location.
export class RemoteSolutionServices implements ISolutionServices
{
    private readonly language: RemoteLanguageService

    public constructor(
        private readonly provider: IServiceProvider,
        session: IRemoteLanguageSession,
        localBase: ILocalBaseResolution,
        log?: IRemoteLanguageLog,
    )
    {
        const memberIds = new SolutionMemberIds(() => this.Manager.ActiveSolution)
        this.language = new RemoteLanguageService(session, localBase, memberIds, log)
    }

    public get Manager(): IManager
    {
        return this.provider.getRequired(SolutionManagerService.Key)
    }

    public get Language(): ILanguageService & IBaseResolver
    {
        return this.language
    }

    public get Build(): IBuildService | undefined
    {
        return this.provider.get(BuildService.Key)
    }

    public get Storage(): StorageService
    {
        return this.provider.getRequired(StorageService.Key)
    }
}
