import { GraphContributorKey, type IGraphContributor, type ContributedPackage, type GraphContributeResult } from '@pragmatic-tech-ai/plexus-core/renderer/modules/graph-contribute'
import type { IGraphContributeApi } from '../../../../shared/graph-contribute-api.js'

// The renderer-side graph contributor: the concrete IGraphContributor resolved through
// GraphContributorKey. A thin wrapper over the preload bridge (window.api.graphContribute); the
// Node contribute call and the maker token stay in main.
export class IpcGraphContributor implements IGraphContributor
{
    public static readonly Key = GraphContributorKey

    private static readonly BridgeUnavailable =
        'IpcGraphContributor: window.api.graphContribute is unavailable — the Electron preload '
        + 'bridge did not load. This service requires a desktop host.'

    private readonly api: IGraphContributeApi

    constructor()
    {
        const bridge = (globalThis as unknown as { api?: { graphContribute?: IGraphContributeApi } }).api
        if (bridge?.graphContribute === undefined)
        {
            throw new Error(IpcGraphContributor.BridgeUnavailable)
        }
        this.api = bridge.graphContribute
    }

    public Contribute(graphName: string, solutionId: string, packages: ContributedPackage[]): Promise<GraphContributeResult>
    {
        return this.api.Contribute(graphName, solutionId, packages)
    }

    public SetProfile(serverUrl: string, token: string): Promise<void>
    {
        return this.api.SetProfile(serverUrl, token)
    }

    public HasProfile(): Promise<boolean>
    {
        return this.api.HasProfile()
    }
}

export default IpcGraphContributor
