// Wire contract for listing an environment's applications and graphs: the renderer<->main IPC
// channel name, the main-process API and the renderer-facing bridge shape (exposed on
// window.api.environments by the preload). Calls go through the relay of the target's source
// with that source's session; no credential crosses this bridge. The structural types are shared
// with plexus-core (renderer) and live there.
import type { AppSummary, GraphSummary, EnvironmentContents } from '@pragmatic-tech-ai/plexus-core/shared/environment-contents-api.js'
import type { RelayReply, TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { CypherParamValue, CypherQueryPageDto, PageParams } from '@pragmatic-tech-ai/pragmatic-protocol'

export type { AppSummary, GraphSummary, EnvironmentContents }

export enum EnvironmentsChannel
{
    Contents = 'environments:contents',
    Cypher = 'environments:cypher',
}

// A read-only Cypher query over the target environment's live graph (the graph DB behind the
// inspect relay). `modelId` is intentionally NOT exposed: the viewer reads the WHOLE graph.
export type EnvironmentCypherParams = { readonly [k: string]: CypherParamValue };

// What the main process does: open an inspect relay to the target's environment and read it.
export interface IEnvironmentsApi
{
    Contents(target: TargetRef): Promise<EnvironmentContents>;
    Cypher(target: TargetRef, cypher: string, params?: EnvironmentCypherParams, page?: PageParams): Promise<CypherQueryPageDto>;
}

// What the preload exposes: resolves to a RelayReply envelope (unwrap with RelayWire.Unwrap), so
// the failure sentence and an account kind survive IPC. Only the target's Name and Source cross.
export interface IEnvironmentsBridge
{
    Contents(target: TargetRef): Promise<RelayReply<EnvironmentContents>>;
    Cypher(target: TargetRef, cypher: string, params?: EnvironmentCypherParams, page?: PageParams): Promise<RelayReply<CypherQueryPageDto>>;
}
