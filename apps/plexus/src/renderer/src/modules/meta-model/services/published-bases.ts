import { ServiceBase, ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { IPublishedBases } from '@pragmatic-tech-ai/plexus-core/renderer/projects'
import type { BaseRef } from '@pragmatic-tech-ai/plexus-core/renderer/projects/base-binding.js'
import { ensurePackagesBackend } from '../../../services/projects/packages-backend.js'
import { scanPublishedModels } from './meta-model-tree-builder.js'
import { discoverLibraries } from '../../library/services/library-loader.js'

// App-side IPublishedBases: enumerates the meta-models / libraries published to the
// single shared packages backend as BaseRefs (`<id>/<version>/`), offered by the New
// Project pickers. Under one root, kind is recovered from each package's unified
// `bundle.json` (checking its `.type`: 'meta-model' vs 'library') — scanPublishedModels
// lists the former, discoverLibraries the latter. Registered under PublishedBasesKey
// (see app.mu).
export class PublishedBases extends ServiceBase implements IPublishedBases
{
    public static readonly Key = new ServiceKey<PublishedBases>('PublishedBases')

    public async ListMetaModels(): Promise<BaseRef[]>
    {
        const backend = ensurePackagesBackend(this.Provider)
        const refs: BaseRef[] = []
        for (const { id, versions } of await scanPublishedModels(backend))
        {
            for (const version of versions) refs.push({ id, version })
        }
        return refs
    }

    public async ListLibraries(): Promise<BaseRef[]>
    {
        const backend = ensurePackagesBackend(this.Provider)
        return (await discoverLibraries(backend)).map((lib) => ({ id: lib.id, version: lib.version }))
    }
}

export default PublishedBases
