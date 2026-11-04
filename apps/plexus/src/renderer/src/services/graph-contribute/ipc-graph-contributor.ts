import { GraphContributorKey, type IGraphContributor, type ContributedPackage, type GraphContributeResult } from '@pragmatic-tech-ai/plexus-core/renderer/modules/graph-contribute'
import { RelayWire } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { IGraphContributeBridge } from '../../../../shared/graph-contribute-api.js'

// The renderer-side graph contributor: the concrete IGraphContributor resolved through
// GraphContributorKey. A thin wrapper over the preload bridge (window.api.graphContribute) that
// unwraps each RelayReply, so a failure rejects with its sentence (an AccountError for SignedOut).
// The relay connection and the account session stay in main.
export class IpcGraphContributor implements IGraphContributor
{
    public static readonly Key = GraphContributorKey

    private static readonly BridgeUnavailable =
        'IpcGraphContributor: window.api.graphContribute is unavailable — the Electron preload '
        + 'bridge did not load. This service requires a desktop host.'

    private readonly api: IGraphContributeBridge

    constructor()
    {
        const bridge = (globalThis as unknown as { api?: { graphContribute?: IGraphContributeBridge } }).api
        if (bridge?.graphContribute === undefined)
        {
            throw new Error(IpcGraphContributor.BridgeUnavailable)
        }
        this.api = bridge.graphContribute
    }

    public async Contribute(environment: string, graphName: string, solutionId: string, packages: ContributedPackage[]): Promise<GraphContributeResult>
    {
        return RelayWire.Unwrap(await this.api.Contribute(environment, graphName, solutionId, packages))
    }

    public async ListGraphs(environment: string): Promise<string[]>
    {
        return RelayWire.Unwrap(await this.api.ListGraphs(environment))
    }
}

export default IpcGraphContributor
