import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { ContributedPackage, GraphContributeResult } from '../../../shared/graph-contribute-api.js'

// Host-agnostic graph capability: contribute a built solution's packages to a dev graph on the
// configured server, and configure that server profile. The UX side depends only on this
// interface + key; the desktop host (apps/plexus) supplies the impl over its preload bridge, and
// the contribute call itself (Node client, maker bearer token) runs in the main process.
export interface IGraphContributor
{
    Contribute(graphName: string, solutionId: string, packages: ContributedPackage[]): Promise<GraphContributeResult>;
    // Stores the server URL and maker token (write-only: nothing returns the token).
    SetProfile(serverUrl: string, token: string): Promise<void>;
    HasProfile(): Promise<boolean>;
}

export const GraphContributorKey = new ServiceKey<IGraphContributor>('GraphContributor')
