import type { IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { PackageKind, ProducerStorageBackendsKey, type IProducerStorageBackends } from '@pragmatic-tech-ai/todl'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

import { ensureMetaModelsBackend } from '../../modules/meta-model/services/meta-models-backend.js'
import { ensureLibrariesBackend } from '../../modules/library/services/libraries-backend.js'

// The concrete IProducerStorageBackends the producer factories (now in todl) resolve through
// ProducerStorageBackendsKey. It resolves the shared meta-models / libraries storage roots,
// lazily registering each on the app's StorageService on first use — the app-coupled
// half of the seam; todl owns only the contract. Rooted at <userData>/meta-models and
// <userData>/libraries via the local-FS backend today.
export class StorageServiceBackends implements IProducerStorageBackends
{
    // Registered under todl's ProducerStorageBackendsKey (the `.services:` addInstance
    // convention keys by static Key), so the producer factories resolve it.
    public static readonly Key = ProducerStorageBackendsKey

    constructor(private readonly provider: IServiceProvider) {}

    public Backend(kind: PackageKind): IStorage
    {
        return kind === PackageKind.Library
            ? ensureLibrariesBackend(this.provider)
            : ensureMetaModelsBackend(this.provider)
    }
}
