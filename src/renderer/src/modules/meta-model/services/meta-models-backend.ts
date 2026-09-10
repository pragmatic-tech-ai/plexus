import type { IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import { StorageProviderRegistry } from '../../../services/storage/storage-provider-registry.js'
import { LocalFileStorage } from '../../../services/storage/local-file-storage.js'
import { FileSystemService } from '../../../services/file-system/file-system-service.js'
import { EnvironmentService } from '../../../services/environment/environment-service.js'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

// The storage backend where published meta-models live. It is a normal rooted
// IStorage registered on the shared StorageProviderRegistry, so publishing flows
// through the same seam as project storage and a cloud/REST backend can replace
// it later. Rooted at <userData>/meta-models via the local-FS backend today.
export const META_MODELS_BACKEND_ID = 'meta-models'

// Resolve the meta-models storage, lazily registering the backend on first use
// (idempotent via Has). Kept lazy rather than an eager startup service so
// nothing pays for it until a publish actually happens.
export function ensureMetaModelsBackend(provider: IServiceProvider): IStorage
{
    const registry = provider.getRequired(StorageProviderRegistry.Key)
    if (!registry.Has(META_MODELS_BACKEND_ID))
    {
        const env = provider.getRequired(EnvironmentService.Key)
        const fs = provider.getRequired(FileSystemService.Key)
        const root = `${env.UserDataDirectory}${env.PathSeparator}meta-models`
        registry.Register(META_MODELS_BACKEND_ID, () => new LocalFileStorage(root, fs))
    }
    // The factory ignores its location argument — the store is app-global, rooted
    // once at <userData>/meta-models.
    return registry.Create(META_MODELS_BACKEND_ID, '')
}
