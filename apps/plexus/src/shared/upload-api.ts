// Wire contract for the "Upload to dev environment" feature: the renderer<->main IPC channel name and
// the renderer-facing bridge shape (exposed on window.api.upload by the preload). The call goes
// through the relay of the target's source with that source's session; no credential crosses this
// bridge. The structural types are shared with plexus-core (renderer) and live there.
import type { UploadContribution, UploadEntry } from '@pragmatic-tech-ai/plexus-core/shared/upload-api.js'
import type { RelayReply, TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'

export type { UploadContribution, UploadEntry }

export enum UploadChannel
{
    Upload = 'upload:upload',
}

// What the preload exposes: the call resolves to its RelayReply envelope (unwrap with
// RelayWire.Unwrap), so the failure sentence and an account kind survive IPC.
export interface IUploadBridge
{
    Upload(target: TargetRef, solutionName: string, tree: UploadEntry[], contribution?: UploadContribution): Promise<RelayReply<void>>;
}
