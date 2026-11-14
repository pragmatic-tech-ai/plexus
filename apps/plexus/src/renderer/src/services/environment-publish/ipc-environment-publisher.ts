import { EnvironmentPublisherKey, type IEnvironmentPublisher, type EnvironmentPublishResult } from '@pragmatic-tech-ai/plexus-core/renderer/modules/environment-publish'
import { RelayWire, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { IEnvironmentPublishBridge } from '../../../../shared/environment-publish-api.js'

// The renderer-side environment publisher: the concrete IEnvironmentPublisher plexus-core's
// PublishToEnvironmentContributor resolves (through EnvironmentPublisherKey). A thin wrapper over the
// preload bridge (window.api.environmentPublish) that unwraps the RelayReply, so a failure rejects with
// its sentence (an AccountError for SignedOut). The upload and the account session stay in main.
export class IpcEnvironmentPublisher implements IEnvironmentPublisher
{
    public static readonly Key = EnvironmentPublisherKey

    private static readonly BridgeUnavailable =
        'IpcEnvironmentPublisher: window.api.environmentPublish is unavailable — the Electron preload '
        + 'bridge did not load. This service requires a desktop host.'

    private readonly api: IEnvironmentPublishBridge

    constructor()
    {
        const bridge = (globalThis as unknown as { api?: { environmentPublish?: IEnvironmentPublishBridge } }).api
        if (bridge?.environmentPublish === undefined)
        {
            throw new Error(IpcEnvironmentPublisher.BridgeUnavailable)
        }
        this.api = bridge.environmentPublish
    }

    public async Publish(target: TargetRef, outputDir: string): Promise<EnvironmentPublishResult>
    {
        return RelayWire.Unwrap(await this.api.Deploy(IpcEnvironmentPublisher.Wire(target), outputDir))
    }

    // Only Name and Source cross the bridge, whatever else the caller's object carries.
    private static Wire(target: TargetRef): TargetRef
    {
        return { Name: target.Name, Source: target.Source }
    }
}

export default IpcEnvironmentPublisher
