import type { ContributedPackageDto } from '@pragmatic-tech-ai/pragmatic-protocol'
import { TargetKind } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { GraphContributeResult, IGraphContributeApi } from '../../shared/graph-contribute-api.js'
import { RelayConnector, type IRelayConnector, type RelayClient } from '../account/relay-connector.js'

// Main-process contribute: opens a contribute relay to a Development environment through the tenant
// plane (RelayConnector holds the session; the environment credential never leaves the server),
// lists its graphs or contributes a solution's compiled packages to one, and always closes the
// connection. Relay refusals and a relay that drops mid-call arrive as sentences; server rejections
// (conflict, not found) keep the server's own message.
export class GraphContributeService implements IGraphContributeApi
{
    constructor(private readonly relay: IRelayConnector)
    {
    }

    public Contribute(environment: string, graphName: string, solutionId: string, packages: readonly ContributedPackageDto[]): Promise<GraphContributeResult>
    {
        return this.With(environment, async (client) =>
        {
            const detail = await client.ContributeGraph({ graphName, solutionId, packages: [...packages] })
            return { GraphName: detail.name, PackageCount: detail.packages.length }
        })
    }

    public ListGraphs(environment: string): Promise<string[]>
    {
        return this.With(environment, async (client) => (await client.ListGraphs()).map(g => g.name).sort((a, b) => a.localeCompare(b)))
    }

    private async With<T>(environment: string, work: (client: RelayClient) => Promise<T>): Promise<T>
    {
        const client = await this.relay.Connect(environment, TargetKind.Contribute)
        try
        {
            return await RelayConnector.Call(environment, () => work(client))
        }
        finally
        {
            await GraphContributeService.Close(client)
        }
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
