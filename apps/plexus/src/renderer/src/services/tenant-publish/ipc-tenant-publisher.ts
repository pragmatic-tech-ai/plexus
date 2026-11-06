import { TenantPublisherKey, type ITenantPublisher, type TenantPublishResult } from '@pragmatic-tech-ai/plexus-core/renderer/modules/tenant-publish'
import { RelayWire, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { ITenantPublishBridge } from '../../../../shared/tenant-publish-api.js'

// The renderer-side tenant publisher: the concrete ITenantPublisher plexus-core's
// PublishTenantContributor resolves (through TenantPublisherKey). A thin wrapper over the
// preload bridge (window.api.tenantPublish) that unwraps the RelayReply, so a failure rejects with
// its sentence (an AccountError for SignedOut). The upload and the account session stay in main.
export class IpcTenantPublisher implements ITenantPublisher
{
    public static readonly Key = TenantPublisherKey

    private static readonly BridgeUnavailable =
        'IpcTenantPublisher: window.api.tenantPublish is unavailable — the Electron preload '
        + 'bridge did not load. This service requires a desktop host.'

    private readonly api: ITenantPublishBridge

    constructor()
    {
        const bridge = (globalThis as unknown as { api?: { tenantPublish?: ITenantPublishBridge } }).api
        if (bridge?.tenantPublish === undefined)
        {
            throw new Error(IpcTenantPublisher.BridgeUnavailable)
        }
        this.api = bridge.tenantPublish
    }

    public async Publish(target: TargetRef, outputDir: string): Promise<TenantPublishResult>
    {
        return RelayWire.Unwrap(await this.api.Deploy(IpcTenantPublisher.Wire(target), outputDir))
    }

    // Only Name and Source cross the bridge, whatever else the caller's object carries.
    private static Wire(target: TargetRef): TargetRef
    {
        return { Name: target.Name, Source: target.Source }
    }
}

export default IpcTenantPublisher
