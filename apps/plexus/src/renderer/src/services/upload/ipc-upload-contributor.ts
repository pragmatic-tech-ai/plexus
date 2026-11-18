import { UploadContributorKey, type IUploadContributor } from '@pragmatic-tech-ai/plexus-core/renderer/modules/upload'
import { RelayWire, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { IUploadBridge, UploadContribution, UploadEntry } from '../../../../shared/upload-api.js'

// The renderer-side upload contributor: the concrete IUploadContributor resolved through
// UploadContributorKey. A thin wrapper over the preload bridge (window.api.upload) that unwraps the
// RelayReply, so a failure rejects with its sentence (an AccountError for SignedOut). The relay
// connection and the account session stay in main.
export class IpcUploadContributor implements IUploadContributor
{
    public static readonly Key = UploadContributorKey

    private static readonly BridgeUnavailable =
        'IpcUploadContributor: window.api.upload is unavailable - the Electron preload '
        + 'bridge did not load. This service requires a desktop host.'

    private readonly api: IUploadBridge

    public constructor()
    {
        const bridge = (globalThis as unknown as { api?: { upload?: IUploadBridge } }).api
        if (bridge?.upload === undefined)
        {
            throw new Error(IpcUploadContributor.BridgeUnavailable)
        }
        this.api = bridge.upload
    }

    public async Upload(target: TargetRef, solutionName: string, tree: UploadEntry[], contribution?: UploadContribution): Promise<void>
    {
        RelayWire.Unwrap(await this.api.Upload({ Name: target.Name, Source: target.Source }, solutionName, tree, contribution))
    }
}

export default IpcUploadContributor
