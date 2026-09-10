import type { IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import { StorageProviderRegistry } from '../../../services/storage/storage-provider-registry.js'
import { LocalFileStorage } from '../../../services/storage/local-file-storage.js'
import { FileSystemService } from '../../../services/file-system/file-system-service.js'
import { EnvironmentService } from '../../../services/environment/environment-service.js'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

// The storage backend where published libraries live. A normal rooted IStorage on
// the shared StorageProviderRegistry — the same seam as project + meta-models
// storage, so a cloud/REST backend can replace it later. Rooted at
// <userData>/libraries via the local-FS backend today. A published library lives
// at <id>/<libVersion>/model.json (+ src/<uri>), mirroring the meta-models layout.
export const LIBRARIES_BACKEND_ID = 'libraries'

// Resolve the libraries storage, lazily registering the backend on first use
// (idempotent via Has). Kept lazy rather than an eager startup service so nothing
// pays for it until a publish (or a base resolution) actually happens.
export function ensureLibrariesBackend(provider: IServiceProvider): IStorage
{
    const registry = provider.getRequired(StorageProviderRegistry.Key)
    if (!registry.Has(LIBRARIES_BACKEND_ID))
    {
        const env = provider.getRequired(EnvironmentService.Key)
        const fs = provider.getRequired(FileSystemService.Key)
        const root = `${env.UserDataDirectory}${env.PathSeparator}libraries`
        registry.Register(LIBRARIES_BACKEND_ID, () => new LocalFileStorage(root, fs))
    }
    // The factory ignores its location argument — the store is app-global, rooted
    // once at <userData>/libraries.
    return registry.Create(LIBRARIES_BACKEND_ID, '')
}
