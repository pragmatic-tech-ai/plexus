import { ServiceBase, ServiceKey } from '@pragmatic-tech-ai/mural/runtime';
import type { IServiceProvider } from '@pragmatic-tech-ai/mural/runtime';
import type { IStorage, IStorageProvider } from '@pragmatic-tech-ai/todl-runtime';
import { FileSystemService } from './file-system-service.js';
import { LocalFileStorage } from './local-file-storage.js';

// Builds a rooted IStorage for a location (an absolute folder locally, a
// container id/URL remotely). Registered under a backend id — a storage provider.
export type StorageProviderFactory = (location: string) => IStorage;

// StorageService — the universal storage front door, shared by every mural desktop
// app in the workspace. It IS the provider registry: a backend id maps to the
// factory that builds its rooted IStorage. Consumers resolve one service
// (StorageService.Key) and ask it for storage — CreateStorage(location) for the
// default provider, Create(id, location) for a named one — without knowing which
// backend is behind it (local FS today, cloud/REST later).
//
// The local filesystem is just the built-in default provider ('local'), registered
// in the constructor like any other. It news a LocalFileStorage over the shared
// FileSystemService, resolved lazily inside the factory so the service stays
// host-agnostic until 'local' is actually used (a non-desktop host that never
// touches it never needs the native bridge). Additional providers (meta-models,
// libraries, a future cloud backend) register the same way via Register().
//
// Concrete and core: composed once by the Storage module (its `.services:`
// registers this as a root singleton under Key), so no app subclasses it.
export class StorageService extends ServiceBase implements IStorageProvider {
    // The token every consumer resolves the service through — the single shared
    // token both apps use (no per-app subclass Key).
    public static readonly Key = new ServiceKey<StorageService>('StorageService');

    // The conventional built-in provider every app ships (the local filesystem).
    public static readonly DefaultBackendId = 'local';

    private readonly factories = new Map<string, StorageProviderFactory>();

    constructor(provider: IServiceProvider) {
        super(provider);
        // Register the built-in local-FS provider. FileSystemService is resolved
        // lazily, per Create() call, so constructing the service on a host without
        // the native bridge is fine until 'local' storage is actually requested.
        this.Register(
            StorageService.DefaultBackendId,
            (location) =>
                new LocalFileStorage(location, this.Provider.getRequired(FileSystemService.Key)),
        );
    }

    public Register(id: string, factory: StorageProviderFactory): void {
        this.factories.set(id, factory);
    }

    public Has(id: string): boolean {
        return this.factories.has(id);
    }

    // Build a rooted IStorage for a backend id. Throws for an unregistered id
    // (a project whose manifest names a backend this build doesn't ship).
    public Create(id: string, location: string): IStorage {
        const factory = this.factories.get(id);
        if (factory === undefined) throw new Error(`Unknown storage backend "${id}".`);
        return factory(location);
    }

    // Rooted IStorage for a folder using the default provider. Satisfies the
    // solution package's IStorageProviderRegistry so a SolutionManagerService can
    // root the solution + its members without knowing the backend id.
    public CreateStorage(location: string): IStorage {
        return this.Create(StorageService.DefaultBackendId, location);
    }
}
