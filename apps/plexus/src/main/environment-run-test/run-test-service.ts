import type { TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { AppDeployResultDto } from '@pragmatic-tech-ai/pragmatic-protocol'
import { EnvironmentDeployService } from '../environment-publish/environment-deploy-service.js'
import { RelayAction, RelayConnector, type IRelayConnector, type RelayClient } from '../account/relay-connector.js'

// Main-process run/test: reads the output directory of a finished html-bundle-remote build and
// assembles the same CypherAppDeployParamsDto EnvironmentDeployService does (the build-output
// reading, trust boundary and params assembly are shared, not copied), but loads it into the
// developer's OWN co-located runtime host through the RunTest relay (runtime/run-test) rather than
// deploying to a separate Runtime environment. The build output is read before the relay is opened,
// so a bad output never connects. Verification afterwards uses ListApplications, not GetLoadedGraph
// (null on this path).
export class RunTestService
{
    constructor(private readonly relay: IRelayConnector)
    {
    }

    public async Run(target: TargetRef, outputDir: string): Promise<AppDeployResultDto>
    {
        EnvironmentDeployService.RequireBuildDir(outputDir)
        const params = await EnvironmentDeployService.AssembleOrSentence(outputDir)
        const client = await this.relay.Connect(target, RelayAction.RunTest)
        try
        {
            return await RelayConnector.Call({ Environment: target.Name, Client: client }, () => client.LoadRunTest(params))
        }
        finally
        {
            await RunTestService.Close(client)
        }
    }

    // A failing close must not hide the run's own outcome.
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
