// Wire contract for the "Publish to tenant" feature: the renderer<->main IPC channel name, the
// main-process API and the renderer-facing bridge shape (exposed on window.api.tenantPublish by the
// preload). The upload goes through the relay of the target's source with that session; no credential
// crosses this bridge. The status enum and result shape are shared with plexus-core (renderer).
import type { TenantPublishResult } from '@pragmatic-tech-ai/plexus-core/shared/tenant-publish-api.js'
import type { RelayReply, TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'

export type { TenantPublishResult }

export enum TenantPublishChannel
{
    Deploy = 'tenant-publish:deploy',
}

// What the main process does for the channel. The upload goes to the session of the target's source.
export interface ITenantPublishApi
{
    // Uploads the already-built remote-flavor output directory to a Runtime environment.
    Deploy(target: TargetRef, outputDir: string): Promise<TenantPublishResult>;
}

// What the preload exposes: the call resolves to its RelayReply envelope (unwrap with
// RelayWire.Unwrap), so the failure sentence and an account kind survive IPC. Only the target's
// Name and Source cross.
export interface ITenantPublishBridge
{
    Deploy(target: TargetRef, outputDir: string): Promise<RelayReply<TenantPublishResult>>;
}
