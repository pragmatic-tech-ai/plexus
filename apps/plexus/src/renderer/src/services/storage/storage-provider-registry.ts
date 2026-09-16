import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import { FileSystemService } from '../file-system/file-system-service.js'
import { LocalFileStorage } from './local-file-storage.js'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

// Builds a rooted IStorage for a location (an absolute folder locally, a
// container id/URL remotely). Registered under a backend id.
export type StorageProviderFactory = (location: string) => IStorage

// StorageProviderRegistry — maps a backend id → the factory that builds its
// storage. The generic ProjectExplorerService reads a project manifest's
// optional `storage` field (default 'local') and calls Create(id, location) to
// get the IStorage it hands to the project factory.
//
// Deliberately a plain Plexus service, not a Mural-declarative module block:
// with one backend and everything living in Plexus, module-contribution
// machinery is unearned (see the design spec). Additional backends register
// against this same surface.
export class StorageProviderRegistry extends ServiceBase
{
    public static readonly Key = new ServiceKey<StorageProviderRegistry>('StorageProviderRegistry')
    public static readonly DefaultBackendId = 'local'

    private readonly factories = new Map<string, StorageProviderFactory>()

    constructor(provider: IServiceProvider)
    {
        super(provider)
        // The built-in local-FS backend: a LocalFileStorage over the Electron
        // FileSystemService, rooted at the given absolute folder.
        this.Register(
            StorageProviderRegistry.DefaultBackendId,
            (location) => new LocalFileStorage(location, this.Provider.getRequired(FileSystemService.Key)),
        )
    }

    public Register(id: string, factory: StorageProviderFactory): void
    {
        this.factories.set(id, factory)
    }

    public Has(id: string): boolean
    {
        return this.factories.has(id)
    }

    // Build a rooted IStorage for a backend id. Throws for an unregistered id
    // (a project whose manifest names a backend this build doesn't ship).
    public Create(id: string, location: string): IStorage
    {
        const factory = this.factories.get(id)
        if (factory === undefined) throw new Error(`Unknown storage backend "${id}".`)
        return factory(location)
    }
}
