import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { TargetRef } from '../../../shared/account-api.js'

// Host-agnostic capability: list the solutions held by a Development environment. The UX side
// depends only on this interface + key; the desktop host (apps/plexus) supplies the impl over its
// preload bridge, and the call itself runs in the main process through a develop relay of the
// target's source (which holds the environment credential).
export interface IEnvSolutionLister
{
    // The environment's solution names, sorted.
    ListSolutions(target: TargetRef): Promise<string[]>;
}

export const EnvSolutionListerKey = new ServiceKey<IEnvSolutionLister>('EnvSolutionLister')
