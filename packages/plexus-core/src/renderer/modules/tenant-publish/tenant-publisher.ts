import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'

// The outcome of one publish, as reported by the tenant server. Status is the protocol's
// AppWriteStatus wire value ('applied', 'denied', ...). Carries no credentials.
export interface TenantPublishResult
{
    Status: string;
    Reason?: string;
    AppName: string;
    AppVersion: string;
}

// Host-agnostic "upload a built remote app to the configured tenant" capability. The UX side
// (PublishTenantContributor) depends only on this interface + key; the desktop host
// (apps/plexus) supplies the impl over its preload bridge, and the upload itself (Node client,
// admin bearer token) runs in the main process.
export interface ITenantPublisher
{
    Publish(outputDir: string): Promise<TenantPublishResult>;
}

export const TenantPublisherKey = new ServiceKey<ITenantPublisher>('TenantPublisher')
