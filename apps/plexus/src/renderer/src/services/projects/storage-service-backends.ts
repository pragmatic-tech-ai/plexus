import type { IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { PackageStoreKey, StoragePackageStore, type IPackageStore, type PackageRef, type SourcedPackage } from '@pragmatic-tech-ai/todl'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

import { ensurePackagesBackend } from './packages-backend.js'

// The concrete IPackageStore the producer factories (now in todl) resolve through
// PackageStoreKey at publish + base-resolution time. Its `Storage` is the single
// app-global packages backend (rooted at <userData>/packages via the local-FS
// backend today); `TryGet` delegates to a StoragePackageStore over that storage
// (which reads <id>/<version>/model.json). The app-coupled half of the seam — todl
// owns only the contract.
export class PlexusPackageStore implements IPackageStore
{
    // Registered under todl's PackageStoreKey (the `.services:` addInstance
    // convention keys by static Key), so the producer factories resolve it.
    public static readonly Key = PackageStoreKey

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

export default PlexusPackageStore
