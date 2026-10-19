import { TenantPublisherKey, type ITenantPublisher, type TenantPublishResult } from '@pragmatic-tech-ai/plexus-core/renderer/modules/tenant-publish'
import type { ITenantPublishApi } from '../../../../shared/tenant-publish-api.js'

// The renderer-side tenant publisher: the concrete ITenantPublisher plexus-core's
// PublishTenantContributor resolves (through TenantPublisherKey). A thin wrapper over the
// preload bridge (window.api.tenantPublish); the Node upload and the admin token stay in main.
export class IpcTenantPublisher implements ITenantPublisher
{
    public static readonly Key = TenantPublisherKey

    private static readonly BridgeUnavailable =
        'IpcTenantPublisher: window.api.tenantPublish is unavailable — the Electron preload '
        + 'bridge did not load. This service requires a desktop host.'

    private readonly api: ITenantPublishApi

    constructor()
    {
        const bridge = (globalThis as unknown as { api?: { tenantPublish?: ITenantPublishApi } }).api
        if (bridge?.tenantPublish === undefined)
        {
            throw new Error(IpcTenantPublisher.BridgeUnavailable)
        }
        this.api = bridge.tenantPublish
    }

    public Publish(outputDir: string): Promise<TenantPublishResult>
    {
        return this.api.Deploy(outputDir)
    }

    public SetProfile(serverUrl: string, token: string): Promise<void>
    {
        return this.api.SetProfile(serverUrl, token)
    }
}

export default IpcTenantPublisher
