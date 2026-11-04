import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { TenantPublishResult } from '../../../shared/tenant-publish-api.js'

// Host-agnostic tenant capability: upload a built remote app to a Runtime environment. The UX side
// (PublishTenantContributor) depends only on this interface + key; the desktop host (apps/plexus)
// supplies the impl over its preload bridge, and the upload itself runs in the main process through
// the tenant plane relay (which holds the environment credential).
export interface ITenantPublisher
{
    Publish(environment: string, outputDir: string): Promise<TenantPublishResult>;
}

export const TenantPublisherKey = new ServiceKey<ITenantPublisher>('TenantPublisher')
