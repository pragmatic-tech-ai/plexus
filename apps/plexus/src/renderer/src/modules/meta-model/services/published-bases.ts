import { ServiceBase, ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import type { IPublishedBases } from '@pragmatic-tech-ai/plexus-core/renderer/projects'
import type { BaseRef } from '@pragmatic-tech-ai/plexus-core/renderer/projects/base-binding.js'
import { ensureMetaModelsBackend } from './meta-models-backend.js'
import { ensureLibrariesBackend } from '../../library/services/libraries-backend.js'

// App-side IPublishedBases: enumerates the meta-models / libraries published to
// the registry backends as BaseRefs (`<id>/<version>/`), offered by the New
// Project pickers. Registered under PublishedBasesKey (see app.mu).
export class PublishedBases extends ServiceBase implements IPublishedBases
{
    public static readonly Key = new ServiceKey<PublishedBases>('PublishedBases')

    public ListMetaModels(): Promise<BaseRef[]>
    {
        return this.enumerate(ensureMetaModelsBackend(this.Provider))
    }

    public ListLibraries(): Promise<BaseRef[]>
    {
        return this.enumerate(ensureLibrariesBackend(this.Provider))
    }

    private async enumerate(backend: IStorage): Promise<BaseRef[]>
    {
        const refs: BaseRef[] = []
        for (const id of await backend.List('')) {
            if (!id.IsDirectory) continue
            for (const version of await backend.List(id.Name)) {
                if (version.IsDirectory) refs.push({ id: id.Name, version: version.Name })
            }
        }
        return refs
    }
}

export default PublishedBases
