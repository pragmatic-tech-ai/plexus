import { ErrorCodes, ResponseError } from '@pragmatic-tech-ai/pragmatic-protocol'
import type { TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { AppSummary, EnvironmentContents, GraphSummary, IEnvironmentsApi } from '../../shared/environment-contents-api.js'
import { RelayAction, RelayConnector, type IRelayConnector, type RelayClient } from '../account/relay-connector.js'

// Main-process environment listing: opens a read-only inspect relay to the target's environment
// through the session of its source (the environment credential never leaves the server), reads its
// applications, named graphs and loaded graph, merges them into one EnvironmentContents and always
// closes the connection. An environment that does not serve one of the reads — because the method is
// unknown (-32601) or because the read is wrong for the environment's purpose (a development
// environment has no application registry; a runtime environment has no named-graph list, so the
// server answers InvalidRequest) — simply contributes nothing for it; every other failure surfaces
// as the relay's plain sentence.
export class EnvironmentContentsService implements IEnvironmentsApi
{
    constructor(private readonly relay: IRelayConnector)
    {
    }

    public Contents(target: TargetRef): Promise<EnvironmentContents>
    {
        return this.With(target, async (client) =>
        {
            const [apps, named, loaded] = await Promise.all([
                EnvironmentContentsService.Tolerate(() => client.ListApplications(), []),
                EnvironmentContentsService.Tolerate(() => client.ListGraphs(), []),
                EnvironmentContentsService.Tolerate(() => client.GetLoadedGraph(), null),
            ])
            return EnvironmentContentsService.Merge(apps, named, loaded)
        })
    }

    private async With<T>(target: TargetRef, work: (client: RelayClient) => Promise<T>): Promise<T>
    {
        const client = await this.relay.Connect(target, RelayAction.Inspect)
        try
        {
            return await RelayConnector.Call({ Environment: target.Name, Client: client }, () => work(client))
        }
        finally
        {
            await EnvironmentContentsService.Close(client)
        }
    }

    // "This environment does not serve this read" is tolerated: the method is unknown (-32601), or the
    // read does not apply to the environment's purpose (the server answers InvalidRequest). The reads
    // take no caller-supplied input, so an InvalidRequest here means environment shape, not a malformed
    // call. Every other failure (InternalError, a dropped connection, auth) propagates.
    private static async Tolerate<T>(read: () => Promise<T>, fallback: T): Promise<T>
    {
        try
        {
            return await read()
        }
        catch (e)
        {
            if (EnvironmentContentsService.IsUnserved(e)) return fallback
            throw e
        }
    }

    private static IsUnserved(e: unknown): boolean
    {
        return e instanceof ResponseError && (e.code === ErrorCodes.MethodNotFound || e.code === ErrorCodes.InvalidRequest)
    }

    private static Merge(
        apps: ReadonlyArray<{ name: string; version: string }>,
        named: ReadonlyArray<{ name: string; packageCount: number }>,
        loaded: { name: string; packages: ReadonlyArray<unknown> } | null): EnvironmentContents
    {
        const Applications: AppSummary[] = apps.map(a => ({ Name: a.name, Version: a.version }))
        const all: GraphSummary[] = named.map(g => ({ Name: g.name, PackageCount: g.packageCount }))
        if (loaded !== null) all.push({ Name: loaded.name, PackageCount: loaded.packages.length })
        const seen = new Set<string>()
        const Graphs = all.filter(g =>
        {
            if (seen.has(g.Name)) return false
            seen.add(g.Name)
            return true
        })
        return { Applications, Graphs }
    }

    // A failing close must not hide the call's own outcome.
    private static async Close(client: RelayClient): Promise<void>
    {
        try
        {
            await client.DisposeAsync()
        }
        catch
        {
            // the connection is gone either way
        }
    }
}
