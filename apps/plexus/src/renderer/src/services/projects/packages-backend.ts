import type { IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import { StorageService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage'
import { LocalFileStorage } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage'
import { FileSystemService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage'
import { EnvironmentService } from '@pragmatic-tech-ai/plexus-core/renderer/environment/environment-service.js'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

// The single storage backend where every published package lives — meta-models
// and libraries alike — under one root at <userData>/packages. A normal rooted
// IStorage on the shared StorageService (the same seam as project storage), so a
// cloud/REST backend can replace it later. Package ids are globally unique, so kind
// no longer routes storage; a package's kind is recovered from its unified
// `bundle.json` (checking its `.type`: 'meta-model' vs 'library'). A published
// package lives at <id>/<version>/model.json (+ bundle.json, src/, presentation/).
export const PACKAGES_BACKEND_ID = 'packages'

// Resolve the packages storage, lazily registering the backend on first use
// (idempotent via Has). Kept lazy rather than an eager startup service so nothing
// pays for it until a publish (or a base resolution) actually happens.
export function ensurePackagesBackend(provider: IServiceProvider): IStorage
{
    const registry = provider.getRequired(StorageService.Key)
    if (!registry.Has(PACKAGES_BACKEND_ID))
    {
        const env = provider.getRequired(EnvironmentService.Key)
        const fs = provider.getRequired(FileSystemService.Key)
        const root = `${env.UserDataDirectory}${env.PathSeparator}packages`
        registry.Register(PACKAGES_BACKEND_ID, () => new LocalFileStorage(root, fs))
    }
    // The factory ignores its location argument — the store is app-global, rooted
    // once at <userData>/packages.
    return registry.Create(PACKAGES_BACKEND_ID, '')
}
