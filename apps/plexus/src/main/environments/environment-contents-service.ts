import { ErrorCodes, ResponseError } from '@pragmatic-tech-ai/pragmatic-protocol'
import type { TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { AppSummary, EnvironmentContents, GraphSummary, IEnvironmentsApi } from '../../shared/environment-contents-api.js'
import { RelayAction, RelayConnector, type IRelayConnector, type RelayClient } from '../account/relay-connector.js'

// Main-process environment listing: opens a read-only inspect relay to the target's environment
// through the session of its source (the environment credential never leaves the server), reads its
// applications, named graphs and loaded graph, merges them into one EnvironmentContents and always
// closes the connection. An environment type that does not serve one of the reads (-32601) simply
// contributes nothing for it; every other failure surfaces as the relay's plain sentence.
export class EnvironmentContentsService implements IEnvironmentsApi
{
    constructor(private readonly relay: IRelayConnector)
    {
    }

    public Contents(target: TargetRef): Promise<EnvironmentContents>
    {
        return this.With(target, async (client) =>
        {
            const apps = await EnvironmentContentsService.Tolerate(() => client.ListApplications(), [])
            const named = await EnvironmentContentsService.Tolerate(() => client.ListGraphs(), [])
            const loaded = await EnvironmentContentsService.Tolerate(() => client.GetLoadedGraph(), null)
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

    // Only "method not found" is tolerated: that environment type does not serve this read.
    private static async Tolerate<T>(read: () => Promise<T>, fallback: T): Promise<T>
    {
        try
        {
            return await read()
        }
        catch (e)
        {
            if (e instanceof ResponseError && e.code === ErrorCodes.MethodNotFound) return fallback
            throw e
        }
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
