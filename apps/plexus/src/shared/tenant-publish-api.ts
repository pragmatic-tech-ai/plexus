// Wire contract for the "Publish to tenant" feature: the renderer<->main IPC channel names and
// the renderer-facing bridge shape (exposed on window.api.tenantPublish by the preload). The
// admin bearer token is write-only across this bridge: SetProfile accepts it, nothing returns it.
// The status enum and result shape are shared with plexus-core (renderer) and live there.
import type { TenantPublishResult } from '@pragmatic-tech-ai/plexus-core/shared/tenant-publish-api.js'

export type { TenantPublishResult }

export enum TenantPublishChannel
{
    Deploy = 'tenant-publish:deploy',
    SetProfile = 'tenant-publish:set-profile',
    HasProfile = 'tenant-publish:has-profile',
}

export interface ITenantPublishApi
{
    // Uploads the already-built remote-flavor output directory to the configured tenant.
    Deploy(outputDir: string): Promise<TenantPublishResult>;
    // Stores the tenant server URL and the admin bearer token (token encrypted main-side).
    SetProfile(serverUrl: string, token: string): Promise<void>;
    HasProfile(): Promise<boolean>;
}
