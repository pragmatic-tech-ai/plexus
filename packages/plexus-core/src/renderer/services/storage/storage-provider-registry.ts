import { ServiceBase } from '@pragmatic-tech-ai/mural/runtime'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

// Builds a rooted IStorage for a location (an absolute folder locally, a
// container id/URL remotely). Registered under a backend id.
export type StorageProviderFactory = (location: string) => IStorage

// Shared storage-backend registry mechanics for every mural desktop app in the
// workspace: maps a backend id -> the factory that builds its rooted IStorage,
// with one built-in default ('local'). The concrete storage the default backend
// builds is app-specific (an Electron FileSystemService, a window.todl bridge,
// ...), so each app subclasses this, declares its own typed
// ServiceKey('StorageProviderRegistry'), and registers its 'local' backend in
// its constructor. Additional backends register against the same inherited
// surface. Kept abstract: it is never instantiated or registered directly.
export abstract class StorageProviderRegistryBase extends ServiceBase
{
    // The conventional built-in backend every app ships.
    public static readonly DefaultBackendId = 'local'

    private readonly factories = new Map<string, StorageProviderFactory>()

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

    // Rooted IStorage for a folder using the default backend. Satisfies the
    // solution package's IStorageProviderRegistry so a SolutionManagerService can
    // root the solution + its members without knowing the backend id.
    public CreateStorage(location: string): IStorage
    {
        return this.Create(StorageProviderRegistryBase.DefaultBackendId, location)
    }
}
