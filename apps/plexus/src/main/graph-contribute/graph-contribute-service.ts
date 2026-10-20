import type { ContributedPackageDto } from '@pragmatic-tech-ai/pragmatic-protocol'
import type { GraphContributeResult } from '../../shared/graph-contribute-api.js'
import type { IGraphProfileSource } from './graph-profile.js'
import type { IGraphClientFactory } from './graph-client.js'
import { GraphServerUrl } from './graph-profile-store.js'

// Main-process contribute: loads the stored maker profile, connects to the graph server with the
// bearer token and contributes a solution's compiled packages to a named graph. The maker bearer
// token is handed to the client factory and nowhere else: never logged, never put in an
// error/result. Server rejections (conflict / not-found / non-dev) propagate their own message;
// only a connect/auth failure is wrapped, with a fixed prefix and the server URL.
export class GraphContributeService
{
    private static readonly NoProfile = 'No graph server is configured: set the graph server URL and maker token before contributing.'
    private static readonly ConnectFailed = 'Could not connect to the graph server: '

    constructor(private readonly profiles: IGraphProfileSource, private readonly clients: IGraphClientFactory)
    {
    }

    public async Contribute(graphName: string, solutionId: string, packages: readonly ContributedPackageDto[]): Promise<GraphContributeResult>
    {
        // Profile first: a missing profile fails before any network call.
        const profile = await this.profiles.Load()
        if (profile === undefined) throw new Error(GraphContributeService.NoProfile)
        const serverUrl = GraphServerUrl.Validate(profile.ServerUrl)
        const client = await this.connect(serverUrl, profile.Token)
        try
        {
            const detail = await client.ContributeGraph({ graphName, solutionId, packages: [...packages] })
            return { GraphName: detail.name, PackageCount: detail.packages.length }
        }
        finally
        {
            await client.Close()
        }
    }

    private async connect(serverUrl: string, token: string): ReturnType<IGraphClientFactory['Connect']>
    {
        try
        {
            return await this.clients.Connect(serverUrl, token)
        }
        catch
        {
            // Only the fixed prefix and the server URL: the underlying client error detail (which could
            // echo connection material) never reaches the renderer, and the token is never interpolated.
            throw new Error(`${GraphContributeService.ConnectFailed}${serverUrl}`)
        }
    }
}
