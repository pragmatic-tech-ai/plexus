// Wire contract for listing a Development environment's solutions: the renderer<->main IPC channel
// name, the main-process API and the renderer-facing bridge shape (exposed on window.api.envSolutions
// by the preload). The call goes through a develop relay of the target's source with that source's
// session; no credential crosses this bridge.
import type { RelayReply, TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'

export enum EnvSolutionsChannel
{
    ListSolutions = 'env-solutions:list-solutions',
}

export interface IEnvSolutionsApi
{
    // The environment's solution names, sorted.
    ListSolutions(target: TargetRef): Promise<string[]>;
}

export interface IEnvSolutionsBridge
{
    ListSolutions(target: TargetRef): Promise<RelayReply<string[]>>;
}
