// Wire contract for the "Contribute solution to graph" feature: the renderer<->main IPC channel
// names and the renderer-facing bridge shape (exposed on window.api.graphContribute by the
// preload). The bearer token is write-only across this bridge: SetProfile accepts it, nothing
// returns it. The structural types are shared with plexus-core (renderer) and live there.
import type { ContributedPackage, GraphContributeResult } from '@pragmatic-tech-ai/plexus-core/shared/graph-contribute-api.js'

export type { GraphContributeResult, ContributedPackage }

export enum GraphContributeChannel
{
    Contribute = 'graph-contribute:contribute',
    SetProfile = 'graph-contribute:set-profile',
    HasProfile = 'graph-contribute:has-profile',
}

export interface IGraphContributeApi
{
    // Contributes the solution's compiled packages to the named graph on the configured server.
    Contribute(graphName: string, solutionId: string, packages: ContributedPackage[]): Promise<GraphContributeResult>;
    // Stores the server URL and the bearer token (token encrypted main-side).
    SetProfile(serverUrl: string, token: string): Promise<void>;
    HasProfile(): Promise<boolean>;
}
