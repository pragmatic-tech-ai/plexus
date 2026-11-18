import type { TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { IEnvSolutionsApi } from '../../shared/env-solutions-api.js'
import { RelayAction, RelayConnector, type IRelayConnector, type RelayClient } from '../account/relay-connector.js'

// Main-process solution listing: opens a one-shot develop relay to a Development environment through
// the session of the target's source, lists the solutions it holds, and always closes the connection.
// Relay refusals and drops arrive as sentences (RelayConnector.Call).
export class EnvSolutionsService implements IEnvSolutionsApi
{
    constructor(private readonly relay: IRelayConnector)
    {
    }

    public async ListSolutions(target: TargetRef): Promise<string[]>
    {
        // Connect is outside the try on purpose: a failed connect yields no client to close.
        const client = await this.relay.Connect(target, RelayAction.Develop)
        try
        {
            return await RelayConnector.Call({ Environment: target.Name, Client: client }, async () =>
                (await client.ListSolutions()).map(s => s.Name).sort((a, b) => a.localeCompare(b)))
        }
        finally
        {
            await EnvSolutionsService.Close(client)
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
