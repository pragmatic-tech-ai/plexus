import type { IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { PackageKind, ProducerBackendsKey, type IProducerBackends } from '@pragmatic-tech-ai/todl'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

import { ensureMetaModelsBackend } from '../../modules/meta-model/services/meta-models-backend.js'
import { ensureLibrariesBackend } from '../../modules/library/services/libraries-backend.js'

// The concrete IProducerBackends the producer factories (now in todl) resolve through
// ProducerBackendsKey. It resolves the shared meta-models / libraries storage roots,
// lazily registering each on the app's StorageService on first use — the app-coupled
// half of the seam; todl owns only the contract. Rooted at <userData>/meta-models and
// <userData>/libraries via the local-FS backend today.
export class StorageServiceBackends implements IProducerBackends
{
    // Registered under todl's ProducerBackendsKey (the `.services:` addInstance
    // convention keys by static Key), so the producer factories resolve it.
    public static readonly Key = ProducerBackendsKey

    constructor(private readonly provider: IServiceProvider) {}

    public Backend(kind: PackageKind): IStorage
    {
        return kind === PackageKind.Library
            ? ensureLibrariesBackend(this.provider)
            : ensureMetaModelsBackend(this.provider)
    }
}
