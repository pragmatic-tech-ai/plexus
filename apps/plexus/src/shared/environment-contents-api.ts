// Wire contract for listing an environment's applications and graphs: the renderer<->main IPC
// channel name, the main-process API and the renderer-facing bridge shape (exposed on
// window.api.environments by the preload). Calls go through the relay of the target's source
// with that source's session; no credential crosses this bridge. The structural types are shared
// with plexus-core (renderer) and live there.
import type { AppSummary, GraphSummary, EnvironmentContents } from '@pragmatic-tech-ai/plexus-core/shared/environment-contents-api.js'
import type { RelayReply, TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'

export type { AppSummary, GraphSummary, EnvironmentContents }

export enum EnvironmentsChannel
{
    Contents = 'environments:contents',
}

// What the main process does: open an inspect relay to the target's environment and list its contents.
export interface IEnvironmentsApi
{
    Contents(target: TargetRef): Promise<EnvironmentContents>;
}

// What the preload exposes: resolves to a RelayReply envelope (unwrap with RelayWire.Unwrap), so
// the failure sentence and an account kind survive IPC. Only the target's Name and Source cross.
export interface IEnvironmentsBridge
{
    Contents(target: TargetRef): Promise<RelayReply<EnvironmentContents>>;
}
