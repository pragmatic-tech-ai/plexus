import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { ContributedPackage, GraphContributeResult } from '../../../shared/graph-contribute-api.js'
import type { TargetRef } from '../../../shared/account-api.js'

// Host-agnostic graph capability: list the graphs of a Development environment and contribute a
// built solution's packages to one of them. The UX side depends only on this interface + key; the
// desktop host (apps/plexus) supplies the impl over its preload bridge, and the calls themselves run
// in the main process through the relay of the target's source (which holds the environment
// credential).
export interface IGraphContributor
{
    Contribute(target: TargetRef, graphName: string, solutionId: string, packages: ContributedPackage[]): Promise<GraphContributeResult>;
    // The environment's graph names, sorted.
    ListGraphs(target: TargetRef): Promise<string[]>;
}

export const GraphContributorKey = new ServiceKey<IGraphContributor>('GraphContributor')
