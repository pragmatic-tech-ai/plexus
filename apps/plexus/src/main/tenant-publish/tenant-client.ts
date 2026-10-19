import { PragmaticClient } from '@pragmatic-tech-ai/pragmatic-protocol'
import type { AppDeployResultDto, CypherAppDeployParamsDto } from '@pragmatic-tech-ai/pragmatic-protocol'

// The slice of the protocol client the deploy service needs; a fake implements it in tests.
export interface ITenantDeployClient
{
    DeployApplication(params: CypherAppDeployParamsDto): Promise<AppDeployResultDto>;
    Close(): Promise<void>;
}

export interface ITenantClientFactory
{
    Connect(serverUrl: string, token: string): Promise<ITenantDeployClient>;
}

// Production factory: the Node PragmaticClient (not the browser one) authenticated with the
// admin bearer token. The Node entry of the protocol installs the ws dialer factory.
export class PragmaticTenantClientFactory implements ITenantClientFactory
{
    public async Connect(serverUrl: string, token: string): Promise<ITenantDeployClient>
    {
        const client = await PragmaticClient.ConnectAsync(serverUrl, { bearerToken: token })
        return {
            DeployApplication: (params) => client.DeployApplication(params),
            Close: () => client.DisposeAsync(),
        }
    }
}
