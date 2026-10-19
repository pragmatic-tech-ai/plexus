import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { TenantPublishResult } from '../../../shared/tenant-publish-api.js'

// Host-agnostic tenant capability: upload a built remote app to the configured tenant, and
// configure that tenant. The UX side (PublishTenantContributor) depends only on this interface
// + key; the desktop host (apps/plexus) supplies the impl over its preload bridge, and the
// upload itself (Node client, admin bearer token) runs in the main process.
export interface ITenantPublisher
{
    Publish(outputDir: string): Promise<TenantPublishResult>;
    // Stores the tenant server URL and admin token (write-only: nothing returns the token).
    SetProfile(serverUrl: string, token: string): Promise<void>;
}

export const TenantPublisherKey = new ServiceKey<ITenantPublisher>('TenantPublisher')
