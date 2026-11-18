import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { TargetRef } from '../../../shared/account-api.js'
import type { UploadContribution, UploadEntry } from '../../../shared/upload-api.js'

// Host-agnostic upload capability: send an enumerated local solution tree to a Development
// environment (and recompose its graph). The UX depends only on this interface + key; the desktop
// host (apps/plexus) supplies the impl over its preload bridge, and the calls themselves run in
// the main process through the relay of the target's source.
export interface IUploadContributor
{
    Upload(target: TargetRef, solutionName: string, tree: UploadEntry[], contribution?: UploadContribution): Promise<void>;
}

export const UploadContributorKey = new ServiceKey<IUploadContributor>('UploadContributor')
