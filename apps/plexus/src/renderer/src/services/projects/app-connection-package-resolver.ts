import type { PackageRef, SourcedPackage } from '@pragmatic-tech-ai/todl'
import type { IConnectionPackageResolver } from './connection-aware-package-store.js'

// The main-side resolve surface (window.api.connections.Resolve) this resolver drives:
// fetch a published package from a registry connection, best-effort (undefined on any
// failure). A minimal structural view so the resolver needn't depend on the whole api type.
export interface ConnectionResolveApi
{
    Resolve(id: string, version: string, connectionId?: string): Promise<SourcedPackage | undefined>
}

// Maps a consumer project (by its manifest id) to the connection its base closure should
// resolve against. undefined ⇒ the user's default connection (the main bridge's
// RegistryFor(undefined)). 8a ships DefaultEffectiveConnection (always the default); 8b
// replaces it with per-project override → solution default → global default.
export interface IEffectiveConnection
{
    EffectiveConnectionIdFor(consumerId: string): Promise<string | undefined>
}

// The IConnectionPackageResolver the connection-aware package store calls on a local miss:
// pick the consumer's effective connection, then fetch the ref from that registry. The
// underlying Resolve is best-effort (swallows unreachable/missing → undefined), so the
// store degrades to Unresolved rather than throwing or hanging.
export class AppConnectionPackageResolver implements IConnectionPackageResolver
{
    constructor(private readonly api: ConnectionResolveApi, private readonly effective: IEffectiveConnection)
    {
    }

    public async ResolveFor(consumerId: string, ref: PackageRef): Promise<SourcedPackage | undefined>
    {
        const connectionId = await this.effective.EffectiveConnectionIdFor(consumerId)
        return this.api.Resolve(ref.id, ref.version, connectionId)
    }
}

// 8a effective-connection policy: always the user's default connection (undefined ⇒ the
// main bridge resolves RegistryFor(undefined)). 8b supersedes this with a project-aware
// policy that reads the per-project override + solution default from solution.json.
export class DefaultEffectiveConnection implements IEffectiveConnection
{
    public EffectiveConnectionIdFor(): Promise<string | undefined>
    {
        return Promise.resolve(undefined)
    }
}

// Fallback resolver for a host where the connections bridge is absent (a non-Electron
// host, or a test): resolution stays purely local-first — a miss is Unresolved, never a
// connection fetch. Keeps ConnectionAwarePackageStore safe to register unconditionally.
export class LocalOnlyPackageResolver implements IConnectionPackageResolver
{
    public ResolveFor(): Promise<SourcedPackage | undefined>
    {
        return Promise.resolve(undefined)
    }
}
