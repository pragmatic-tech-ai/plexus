import { PragmaticClient } from '@pragmatic-tech-ai/pragmatic-protocol'
import type { GraphContributeParamsDto, GraphDetailDto } from '@pragmatic-tech-ai/pragmatic-protocol'

// The slice of the protocol client the graph-contribute service needs; a fake implements it in tests.
export interface IGraphContributeClient
{
    ContributeGraph(params: GraphContributeParamsDto): Promise<GraphDetailDto>;
    Close(): Promise<void>;
}

export interface IGraphClientFactory
{
    Connect(serverUrl: string, token: string): Promise<IGraphContributeClient>;
}

// The members of PragmaticClient the adapter delegates to (structural, so a spy object satisfies it).
export interface IGraphProtocolClient
{
    ContributeGraph(params: GraphContributeParamsDto): Promise<GraphDetailDto>;
    DisposeAsync(): Promise<void>;
}

export class GraphContributeClientAdapter implements IGraphContributeClient
{
    public constructor(private readonly client: IGraphProtocolClient)
    {
    }

    public ContributeGraph(params: GraphContributeParamsDto): Promise<GraphDetailDto>
    {
        return this.client.ContributeGraph(params)
    }

    public Close(): Promise<void>
    {
        return this.client.DisposeAsync()
    }
}

// Production factory: the Node PragmaticClient authenticated with the maker bearer token.
export class PragmaticGraphClientFactory implements IGraphClientFactory
{
    public async Connect(serverUrl: string, token: string): Promise<IGraphContributeClient>
    {
        const client = await PragmaticClient.ConnectAsync(serverUrl, { bearerToken: token })
        return new GraphContributeClientAdapter(client)
    }
}
