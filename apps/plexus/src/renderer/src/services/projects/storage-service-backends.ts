import type { IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { PackageStoreKey, StoragePackageStore, type IPackageStore, type PackageRef, type SourcedPackage } from '@pragmatic-tech-ai/todl'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ProjectExplorerService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/project-explorer/services/project-explorer-service.js'

import { ensurePackagesBackend } from './packages-backend.js'
import { ConnectionAwarePackageStore, type IConnectionPackageResolver } from './connection-aware-package-store.js'
import { AppConnectionPackageResolver, LocalOnlyPackageResolver, type ConnectionResolveApi, type IEffectiveConnection } from './app-connection-package-resolver.js'

// The local packages IPackageStore: `Storage` is the single app-global packages backend
// (rooted at <userData>/packages via the local-FS backend today); `TryGet` delegates to a
// StoragePackageStore over that storage (which reads <id>/<version>/model.json). This is the
// local half of the seam — todl owns only the contract. It is no longer registered directly;
// ConnectionAwarePlexusPackageStore wraps it under PackageStoreKey (see below).
export class PlexusPackageStore implements IPackageStore
{
    private cached: StoragePackageStore | undefined

    constructor(private readonly provider: IServiceProvider) {}

    public get Storage(): IStorage
    {
        return this.inner().Storage
    }

    public TryGet(reference: PackageRef): Promise<SourcedPackage | undefined>
    {
        return this.inner().TryGet(reference)
    }

    // The StoragePackageStore over the single packages backend, resolved lazily on
    // first use (the ensure* backend needs the storage/env/fs services wired). One
    // instance is reused across calls.
    private inner(): StoragePackageStore
    {
        if (this.cached === undefined) this.cached = new StoragePackageStore(ensurePackagesBackend(this.provider))
        return this.cached
    }
}

// The IPackageStore the producer factories (in todl) resolve through PackageStoreKey at
// publish + base-resolution time. Wraps the local PlexusPackageStore with connection-aware
// fallback: base resolution reads locally first and, only on a miss for a consuming project
// (SolutionBaseResolver threads its manifest id as the resolution context's consumerId),
// fetches the ref from that project's effective connection over the connections bridge. When
// the bridge is absent (non-Electron host / test), it degrades to local-only.
export class ConnectionAwarePlexusPackageStore extends ConnectionAwarePackageStore
{
    // Registered under todl's PackageStoreKey (the `.services:` addInstance convention keys
    // by static Key), so the producer factories resolve THIS (the wrapper), not the bare local store.
    public static readonly Key = PackageStoreKey

    constructor(provider: IServiceProvider)
    {
        super(new PlexusPackageStore(provider), ConnectionAwarePlexusPackageStore.resolver(provider))
    }

    // Resolve missing bases from the consuming project's EFFECTIVE connection (per-project
    // override → solution default → global default, via ProjectExplorerService) when the
    // connections bridge is present; local-only otherwise (non-Electron host / test).
    private static resolver(provider: IServiceProvider): IConnectionPackageResolver
    {
        const api = (globalThis as unknown as { api?: { connections?: ConnectionResolveApi } }).api?.connections
        if (api === undefined) return new LocalOnlyPackageResolver()
        return new AppConnectionPackageResolver(api, new ProjectExplorerEffectiveConnection(provider))
    }
}

// Bridges the package store's effective-connection seam to ProjectExplorerService, which owns
// the per-project override store + the effective-connection precedence. Resolved lazily (on a
// base-resolution miss), by which time ProjectExplorerService is registered.
export class ProjectExplorerEffectiveConnection implements IEffectiveConnection
{
    constructor(private readonly provider: IServiceProvider)
    {
    }

    public EffectiveConnectionIdFor(consumerId: string): Promise<string | undefined>
    {
        const explorer = this.provider.get(ProjectExplorerService.Key)
        return explorer?.EffectiveConnectionIdForConsumer(consumerId) ?? Promise.resolve(undefined)
    }
}

export default ConnectionAwarePlexusPackageStore
