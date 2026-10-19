// Wire contract for the "Publish to tenant" feature: the renderer<->main IPC channel names and
// the renderer-facing bridge shape (exposed on window.api.tenantPublish by the preload). The
// admin bearer token is write-only across this bridge: SetProfile accepts it, nothing returns it.

export enum TenantPublishChannel
{
    Deploy = 'tenant-publish:deploy',
    SetProfile = 'tenant-publish:set-profile',
    HasProfile = 'tenant-publish:has-profile',
}

// The outcome of one deploy, as reported by the server. Status is the protocol's AppWriteStatus
// wire value ('applied', 'denied', ...). Never carries credentials.
export interface TenantPublishResult
{
    Status: string;
    Reason?: string;
    AppName: string;
    AppVersion: string;
}

export interface ITenantPublishApi
{
    // Uploads the already-built remote-flavor output directory to the configured tenant.
    Deploy(outputDir: string): Promise<TenantPublishResult>;
    // Stores the tenant server URL and the admin bearer token (token encrypted main-side).
    SetProfile(serverUrl: string, token: string): Promise<void>;
    HasProfile(): Promise<boolean>;
}
