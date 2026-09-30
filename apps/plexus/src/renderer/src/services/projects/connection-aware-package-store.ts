import type { IPackageStore, PackageRef, SourcedPackage } from '@pragmatic-tech-ai/todl'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

// Structurally compatible with todl's PackageResolutionContext (defined in
// todl's package-source but not re-exported from the package's main entry) — the
// consumer project whose base closure is being resolved.
interface ResolutionContext
{
    consumerId?: string
}

// Resolves a published package for a consumer through its effective connection's
// registry (best-effort). The store passes the consumer id from the resolution
// context; the impl maps it to that project's effective connection and fetches
// over IPC, returning undefined on any miss/failure so resolution stays local-first.
export interface IConnectionPackageResolver
{
    ResolveFor(consumerId: string, ref: PackageRef): Promise<SourcedPackage | undefined>
}

// A connection-aware IPackageStore: reads the local packages backend FIRST
// (unchanged behaviour), and only on a local miss — and only when the resolver
// (SolutionBaseResolver) threaded a consumer id — falls back to that project's
// effective connection. A registry that is unreachable resolves to undefined (the
// resolver swallows failures), so the tree never hangs and the ref decorates
// Unresolved. Registered under todl's PackageStoreKey via
// ConnectionAwarePlexusPackageStore (the provider-constructed wrapper).
export class ConnectionAwarePackageStore implements IPackageStore
{
    constructor(private readonly inner: IPackageStore, private readonly resolver: IConnectionPackageResolver)
    {
    }

    public get Storage(): IStorage
    {
        return this.inner.Storage
    }

    public async TryGet(reference: PackageRef, context?: ResolutionContext): Promise<SourcedPackage | undefined>
    {
        const local = await this.inner.TryGet(reference)
        if (local !== undefined) return local
        const consumerId = context?.consumerId
        if (consumerId === undefined) return undefined
        return this.resolver.ResolveFor(consumerId, reference)
    }
}
