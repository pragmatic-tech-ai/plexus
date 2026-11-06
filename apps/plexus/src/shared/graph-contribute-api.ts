// Wire contract for the "Contribute solution to graph" feature: the renderer<->main IPC channel
// names, the main-process API and the renderer-facing bridge shape (exposed on
// window.api.graphContribute by the preload). Calls go through the relay of the target's source
// with that source's session; no credential crosses this bridge. The structural types are shared with
// plexus-core (renderer) and live there.
import type { ContributedPackage, GraphContributeResult } from '@pragmatic-tech-ai/plexus-core/shared/graph-contribute-api.js'
import type { RelayReply, TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'

export type { GraphContributeResult, ContributedPackage }

export enum GraphContributeChannel
{
    Contribute = 'graph-contribute:contribute',
    ListGraphs = 'graph-contribute:list-graphs',
}

// What the main process does for each channel. Each call goes to the session of the target's source.
export interface IGraphContributeApi
{
    // Contributes the solution's compiled packages to the named graph of a Development environment.
    Contribute(target: TargetRef, graphName: string, solutionId: string, packages: ContributedPackage[]): Promise<GraphContributeResult>;
    // The environment's graph names, sorted.
    ListGraphs(target: TargetRef): Promise<string[]>;
}

// What the preload exposes: each call resolves to its RelayReply envelope (unwrap with
// RelayWire.Unwrap), so the failure sentence and an account kind survive IPC. Only the target's
// Name and Source cross.
export interface IGraphContributeBridge
{
    Contribute(target: TargetRef, graphName: string, solutionId: string, packages: ContributedPackage[]): Promise<RelayReply<GraphContributeResult>>;
    ListGraphs(target: TargetRef): Promise<RelayReply<string[]>>;
}
